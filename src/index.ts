import {
  AccessoryPlugin,
  API, APIEvent, Characteristic,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  HAPStatus,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  StaticPlatformPlugin, uuid
} from "homebridge";

const PLATFORM_NAME = 'PioAVR';
const PLUGIN_NAME = 'homebridge-pioavr';
const PLUGIN_VERSION = '1.0.0';

import {InputSource} from "hap-nodejs/dist/lib/definitions/ServiceDefinitions";

const PioneerAvr = require('./pioneer-avr');
const Input = require('./input');
const PreferencesAccessor = require('./preferences');

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
  hap = api.hap;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, PioAVRPlatform);
};

class PioAVRPlatform implements StaticPlatformPlugin {

  private readonly log: Logging;
  private readonly name: string;

  private readonly tvAccessory: PlatformAccessory;
  private readonly accessory: PlatformAccessory;
  private readonly tvService: Service;
  private readonly tvSpeakerService: Service;
  private readonly avr: typeof PioneerAvr;
  private readonly api: API;
  private readonly host: string;
  private readonly port: number;
  private readonly preferencesAccessor: typeof PreferencesAccessor;
  // private readonly speakerService: Service;
  private readonly lightBulbService: Service;
  private readonly panelLockSwitchService: Service;
  private inputServices: { [key: string]: InputSource } = {};
  private volumeLimit: number = 60; // TODO

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.preferencesAccessor = new PreferencesAccessor(log, api.user.storagePath());
    this.name = config.name || PLATFORM_NAME;
    this.api = api;
    this.host = config['host'];
    this.port = config['port'];

    // create connection and register listeners
    this.avr = new PioneerAvr(this.log, this.host, this.port)
      .on('inputDefinition', this.modifyInputSourceService.bind(this));

    // create all services and accessories
    this.createInputServices();

    this.tvSpeakerService = this.createTvSpeakerService();
    this.tvService = this.createTvService();
    this.tvAccessory = this.createTvAccessory();

    this.lightBulbService = this.createLightBulbService();
    this.panelLockSwitchService = this.createPanelLockButtonService();
    this.accessory = this.createHelperAccessory();

    // register all services with HAP
    this.registerServices();

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.startInputDiscovery.bind(this));
    api.on(APIEvent.SHUTDOWN, this.avr.shutdown.bind(this));
  }

  registerServices(): void {
    this.log.debug('Registering services');

    this.tvAccessory.addService(this.tvService);
    this.tvAccessory.addService(this.tvSpeakerService);
    this.tvService.addLinkedService(this.tvSpeakerService);

    // add input services
    for (let inputServicesKey in this.inputServices) {
      let inputService = this.inputServices[inputServicesKey];
      this.log.debug('Registering input: ' + inputService.displayName);
      this.tvAccessory.addService(inputService);
      this.tvService.addLinkedService(inputService);
    }

    this.api.publishExternalAccessories(PLUGIN_NAME, [ this.tvAccessory ]);
  }

  createTvAccessory(): PlatformAccessory {
    const tvAccessory = new this.api.platformAccessory(this.name, hap.uuid.generate(this.host + this.name + "tvService"));
    tvAccessory.category = hap.Categories.AUDIO_RECEIVER;

    tvAccessory.getService(hap.Service.AccessoryInformation)!
    .setCharacteristic(hap.Characteristic.Manufacturer, "Pioneer")
    .setCharacteristic(hap.Characteristic.Model, "Receiver")
    .setCharacteristic(hap.Characteristic.SerialNumber, this.avr.host)
    .setCharacteristic(hap.Characteristic.FirmwareRevision, PLUGIN_VERSION);

    return tvAccessory;
  }

  createTvService(): Service {
    const tvService = new hap.Service.Television(this.name, 'tvService')
    .setCharacteristic(hap.Characteristic.ConfiguredName, this.name)
    .setCharacteristic(hap.Characteristic.SleepDiscoveryMode, hap.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Set Active charateristic to power on or off AVR
    tvService
    .getCharacteristic(hap.Characteristic.Active)
    .on('get', this.isPowerOn.bind(this))
    .on('set', this.setPower.bind(this));

    // ActiveIdentifier show and set current input on TV badge in homekit
    tvService
    .getCharacteristic(hap.Characteristic.ActiveIdentifier)
    .on('get', this.getInputIdentifier.bind(this))
    .on('set', this.setInputIdentifier.bind(this));

    // Remote Key
    tvService
    .getCharacteristic(hap.Characteristic.RemoteKey)
    .on('set', this.sendRemoteKey.bind(this));

    // Menu button linked to power mode
    tvService
    .getCharacteristic(hap.Characteristic.PowerModeSelection)
    .on('set', this.sendMenuButton.bind(this));

    return tvService;
  }

  createTvSpeakerService(): Service {
    // Create Service.TelevisionSpeaker and  associate to tvService
    const tvSpeakerService = new hap.Service.TelevisionSpeaker(this.name + ' Volume', 'tvSpeakerService');
    tvSpeakerService
    .setCharacteristic(hap.Characteristic.Active, hap.Characteristic.Active.ACTIVE)
    .setCharacteristic(hap.Characteristic.VolumeControlType, hap.Characteristic.VolumeControlType.ABSOLUTE);

    tvSpeakerService
    .getCharacteristic(hap.Characteristic.VolumeSelector)
    .on('set', this.setVolumeStepped.bind(this));

    tvSpeakerService
    .getCharacteristic(hap.Characteristic.Mute)
    .on('get', this.isMuted.bind(this))
    .on('set', this.setMuted.bind(this));

    tvSpeakerService
    .addCharacteristic(hap.Characteristic.Volume)
    .on('get', this.getVolume.bind(this))
    .on('set', this.setVolume.bind(this));

    return tvSpeakerService;
  }

  createLightBulbService(): Service {
    let volume = new hap.Service.Lightbulb(this.name + ' Volume', hap.uuid.generate(this.name + 'Volume' + this.host));

    volume
    .getCharacteristic(hap.Characteristic.On)
    .on('get', this.isNotMuted.bind(this))
    .on('set', this.setNotMuted.bind(this));

    volume
    .addCharacteristic(hap.Characteristic.Brightness)
    .on('get', this.getVolume.bind(this))
    .on('set', this.setVolume.bind(this));

    return volume;
  }

  createPanelLockButtonService(): Service {
    let lock = new hap.Service.Switch(this.name + ' Panel Lock', hap.uuid.generate(this.name + 'PanelLock' + this.host));
    lock.getCharacteristic(hap.Characteristic.On)
    .on('get', this.getPanelLock.bind(this))
    .on('set', this.setPanelLock.bind(this))
    return lock;
  }

  createInputServices(): void {
    for (let key in Input.inputToType) {
      this.inputServices[key] = this.createInputSourceService(key);
    }
  }

  startInputDiscovery(): void {
    this.avr.requestInputDefinitions();
  }

  modifyInputSourceService(index: number, input: Input) {
    this.log.info('Enabling input n°%s - Name: %s Id: %s Type: %s',
        index,
        input.name,
        input.id,
        input.type
    );

    const inputVisibility = this.preferencesAccessor.isInputHidden(input.id)
        ? hap.Characteristic.CurrentVisibilityState.HIDDEN : hap.Characteristic.CurrentVisibilityState.SHOWN;
    const inputSource = this.inputServices[input.id];
    inputSource!
    .updateCharacteristic(hap.Characteristic.IsConfigured, hap.Characteristic.IsConfigured.CONFIGURED)
    .updateCharacteristic(hap.Characteristic.ConfiguredName, input.name) // Name in home app
    .updateCharacteristic(hap.Characteristic.InputSourceType, input.type)
    .updateCharacteristic(hap.Characteristic.CurrentVisibilityState, inputVisibility) // Show in input list
    .updateCharacteristic(hap.Characteristic.TargetVisibilityState, hap.Characteristic.CurrentVisibilityState.SHOWN); // Enable show selection
  };

  createInputSourceService(key: string): InputSource {
    const input = new hap.Service.InputSource('Input' + key, 'tvInputService' + key);

    const inputVisibility = this.preferencesAccessor.isInputHidden(key)
        ? hap.Characteristic.CurrentVisibilityState.HIDDEN : hap.Characteristic.CurrentVisibilityState.SHOWN;

    this.log.info("Input " + input + " is hidden: " + inputVisibility);

    input
    .setCharacteristic(hap.Characteristic.Identifier, key.toString())
    .setCharacteristic(hap.Characteristic.ConfiguredName, 'Input' + key) // Name in home app
    .setCharacteristic(hap.Characteristic.IsConfigured, hap.Characteristic.IsConfigured.NOT_CONFIGURED)
    .setCharacteristic(hap.Characteristic.InputSourceType, hap.Characteristic.InputSourceType.APPLICATION)
    .setCharacteristic(hap.Characteristic.CurrentVisibilityState, inputVisibility)
    .setCharacteristic(hap.Characteristic.TargetVisibilityState, inputVisibility);
    input
    .getCharacteristic(hap.Characteristic.TargetVisibilityState)
    .on('set', (state, callback) => {
      input.setCharacteristic(hap.Characteristic.CurrentVisibilityState, state);
      this.preferencesAccessor.setInputHidden(key, state as boolean)
        .then(() => callback(HAPStatus.SUCCESS))
        .catch((error: any) => callback(HAPStatus.OPERATION_TIMED_OUT));
    });
    input
    .getCharacteristic(hap.Characteristic.ConfiguredName)
    .on('set', (name, callback) => {
      let input = this.avr.inputs.get(key);
      this.log.info('Rename input <%s> to <%s>', input.name, name);
      input.name = name.toString().substring(0,14);
      this.avr.renameInput(key, input.name);
      callback(HAPStatus.SUCCESS);
    });
    return input;
  }

  isMuted(callback: CharacteristicGetCallback): void {
    this.log.debug("isMuted => " + JSON.stringify(this.avr.state));
    this.avr.requestMuteStatus();
    callback(HAPStatus.SUCCESS, this.avr.state.muted);
  }

  isNotMuted(callback: CharacteristicGetCallback): void {
    this.log.debug("isNotMuted => " + JSON.stringify(this.avr.state));
    this.avr.requestMuteStatus();
    callback(HAPStatus.SUCCESS, !this.avr.state.muted);
  }

  setNotMuted(value: CharacteristicValue, callback: CharacteristicGetCallback): void {
    this.log.debug("setNotMuted => " + value);
    if (!value) {
      this.avr.setMuteOn();
    }
    callback(HAPStatus.SUCCESS);
  }

  setMuted(value: CharacteristicValue, callback: CharacteristicGetCallback): void {
    this.log.debug("setMuted => " + value);
    if (value) {
      this.avr.setMuteOn();
    } else {
      this.avr.setMuteOff();
    }
    callback(HAPStatus.SUCCESS);
  }

  getPanelLock(callback: CharacteristicGetCallback): void {
    this.log.debug("getPanelLock => " + JSON.stringify(this.avr.state));
    this.avr.requestPanelLockStatus();
    callback(HAPStatus.SUCCESS, this.avr.state.panelLock);
  }

  setPanelLock(value: CharacteristicValue, callback: CharacteristicGetCallback): void {
    this.log.debug("setPanelLock => " + value);
    if (value) {
      this.avr.setPanelLockOn();
    } else {
      this.avr.setPanelLockOff();
    }
    callback(HAPStatus.SUCCESS);
  }

  getVolume(callback: CharacteristicGetCallback): void {
    this.log.debug("getVolume => " + JSON.stringify(this.avr.state));
    this.avr.requestVolumeStatus();
    callback(HAPStatus.SUCCESS, this.avr.state.volume);
  }

  setVolumeStepped(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.log.debug("setVolumeStepped => " + value);
    if (value === 1) {
      this.avr.volumeDown();
    } else {
      this.avr.volumeUp();
    }
    callback(HAPStatus.SUCCESS);
  }

  setVolume(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.log.debug("setVolume => " + value);
    this.avr.setVolume(Math.min(value as number, this.volumeLimit));
    callback(HAPStatus.SUCCESS);
  }

  isPowerOn(callback: CharacteristicGetCallback): void {
    this.log.debug("isPowerOn => " + JSON.stringify(this.avr.state));
    this.avr.requestPowerStatus();
    callback(HAPStatus.SUCCESS, this.avr.state.on);
  }

  setPower(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.log.debug("setPower => " + value);
    if (value) {
      this.avr.setPowerOn();
    } else {
      this.avr.setPowerOff();
    }
    callback(HAPStatus.SUCCESS);
  }

  getInputIdentifier(callback: CharacteristicGetCallback): void {
    this.log.debug("getInputIdentifier => " + JSON.stringify(this.avr.state));
    this.avr.requestInputStatus();
    callback(HAPStatus.SUCCESS, this.avr.state.input.id);
  }

  setInputIdentifier(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.log.debug("setInputIdentifier => " + value);
    this.avr.setInput(value);
    callback(HAPStatus.SUCCESS);
  }

  sendMenuButton(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.avr.sendRemoteKey('HOME_MENU');
    callback(HAPStatus.SUCCESS);
  }

  sendRemoteKey(remoteKey: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.log.info('Remote key pressed : %s', remoteKey);
    switch (remoteKey) {
      case hap.Characteristic.RemoteKey.REWIND:
        this.log.info('Rewind remote key not implemented');
        break;
      case hap.Characteristic.RemoteKey.FAST_FORWARD:
        this.log.info('Fast forward remote key not implemented');
        break;
      case hap.Characteristic.RemoteKey.NEXT_TRACK:
        this.log.info('Next track remote key not implemented');
        callback();
        break;
      case hap.Characteristic.RemoteKey.PREVIOUS_TRACK:
        this.log.info('Previous track remote key not implemented');
        callback();
        break;
      case hap.Characteristic.RemoteKey.ARROW_UP:
        this.avr.sendRemoteKey('UP');
        break;
      case hap.Characteristic.RemoteKey.ARROW_DOWN:
        this.avr.sendRemoteKey('DOWN');
        break;
      case hap.Characteristic.RemoteKey.ARROW_LEFT:
        this.avr.sendRemoteKey('LEFT');
        break;
      case hap.Characteristic.RemoteKey.ARROW_RIGHT:
        this.avr.sendRemoteKey('RIGHT');
        break;
      case hap.Characteristic.RemoteKey.SELECT:
        this.avr.sendRemoteKey('ENTER');
        break;
      case hap.Characteristic.RemoteKey.BACK:
        this.avr.sendRemoteKey('RETURN');
        break;
      case hap.Characteristic.RemoteKey.EXIT:
        this.avr.sendRemoteKey('RETURN');
        break;
      case hap.Characteristic.RemoteKey.PLAY_PAUSE:
        this.log.info('Play/Pause remote key not implemented');
        break;
      case hap.Characteristic.RemoteKey.INFORMATION:
        this.avr.sendRemoteKey('HOME_MENU');
        break;
    }
    callback(HAPStatus.SUCCESS);
  }

  accessories(callback: (foundAccessories: AccessoryPlugin[]) => void): void {
    // do not return tvAccessory because it's published externally
    callback([]);
  }

  private createHelperAccessory(): PlatformAccessory {
    let accessory = new this.api.platformAccessory(this.name + ' Controls', hap.uuid.generate(this.host + 'AccessoryControls'));
    accessory.addService(this.lightBulbService);
    accessory.addService(this.panelLockSwitchService);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    return accessory;
  }
}
