import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";
import {InputSource} from "hap-nodejs/dist/lib/definitions/ServiceDefinitions";

const PioneerAvr = require('./pioneer-avr');
const Input = require('./input');

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
  api.registerAccessory("homebridge-pioavr", "pioAvrAccessory", PioAVRAccessory);
};

class PioAVRAccessory implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly name: string;
  private switchOn = false;

  private readonly tvService: Service;
  private readonly informationService: Service;
  private readonly tvSpeakerService: Service;
  private readonly avr: typeof PioneerAvr;
  private inputServices: { [key: string]: InputSource } = {};

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    const self = this;
    this.log = log;
    this.name = config.name;

    this.tvService = this.createTvService();
    this.tvSpeakerService = this.createTvSpeakerService();
    this.informationService = this.createInformationService();
    this.createInputServices();

    // create connection and register listeners
    this.avr = new PioneerAvr(this.log, "vsx-921", 23);
    this.avr.on('inputDefinition', (index: number, input: Input) => self.modifyInputSourceService(index, input));
    this.startInputDiscovery();

  }
  createTvService(): Service {
    return new hap.Service.Television(this.name, 'tvService')
      .setCharacteristic(hap.Characteristic.ConfiguredName, this.name)
      .setCharacteristic(hap.Characteristic.SleepDiscoveryMode, hap.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);
  }

  createTvSpeakerService(): Service {
    // Create Service.TelevisionSpeaker and  associate to tvService
    const tvSpeakerService = new hap.Service.TelevisionSpeaker(this.name + ' Volume', 'tvSpeakerService');
    tvSpeakerService
    .setCharacteristic(hap.Characteristic.Active, hap.Characteristic.Active.ACTIVE)
    .setCharacteristic(hap.Characteristic.VolumeControlType, hap.Characteristic.VolumeControlType.ABSOLUTE);
    tvSpeakerService
    .getCharacteristic(hap.Characteristic.VolumeSelector)
    .on('set', (state, callback) => {
      this.log.debug('Volume change over the remote control (VolumeSelector), pressed: %s', state === 1 ? 'Down' : 'Up');
    });
    tvSpeakerService
    .getCharacteristic(hap.Characteristic.Mute)
    // .on('get', this.getMuted.bind(this))
    .on('set', (state, callback) => this.log.debug('Mute'));
    tvSpeakerService
    .addCharacteristic(hap.Characteristic.Volume)
    // .on('get', this.getVolume.bind(this))
    .on('set', (state, callback) => this.log.debug('Set volume'));

    this.tvService.addLinkedService(tvSpeakerService);

    return tvSpeakerService;
  }

  createInformationService(): Service {
    return new hap.Service.AccessoryInformation()
    .setCharacteristic(hap.Characteristic.Manufacturer, "Pioneer")
    .setCharacteristic(hap.Characteristic.Model, "VSX-921");
  }

  createInputServices(): void {
    for (let key in Input.inputToType) {
      this.inputServices[key] = this.createInputSourceService(key);
      this.log.debug("set %s = %s", key, this.inputServices[key]);
    }
    this.log.debug("map created: ", this.inputServices);
  }

  startInputDiscovery(): void {
    this.log.info('Discovering inputs: ', this.inputServices);
    this.avr.requestInputDefinitions();
  }

  modifyInputSourceService(index: number, input: Input) {

    this.log.info('Enabling input n°%s - Name: %s Id: %s Type: %s',
        index,
        input.name,
        input.id,
        input.type
    );

    this.log.debug('map: ' + this.inputServices);

    const inputSource = this.inputServices[input.id];
    this.log.debug("Got inputSource: %s", inputSource);
    inputSource?.setCharacteristic(hap.Characteristic.IsConfigured, hap.Characteristic.IsConfigured.CONFIGURED)
    .setCharacteristic(hap.Characteristic.ConfiguredName, input.name) // Name in home app
    .setCharacteristic(hap.Characteristic.InputSourceType, input.type)
    .setCharacteristic(hap.Characteristic.CurrentVisibilityState, hap.Characteristic.CurrentVisibilityState.SHOWN) // Show in input list
    .setCharacteristic(hap.Characteristic.TargetVisibilityState, hap.Characteristic.CurrentVisibilityState.SHOWN); // Enable show selection
  };

  createInputSourceService(key: string): InputSource {
    const input = new hap.Service.InputSource('Input' + key, 'tvInputService' + key);
    input
    .setCharacteristic(hap.Characteristic.Identifier, key.toString())
    .setCharacteristic(hap.Characteristic.ConfiguredName, 'Input' + key) // Name in home app
    .setCharacteristic(hap.Characteristic.IsConfigured, hap.Characteristic.IsConfigured.NOT_CONFIGURED)
    .setCharacteristic(hap.Characteristic.InputSourceType, 0)
    .setCharacteristic(hap.Characteristic.CurrentVisibilityState, hap.Characteristic.CurrentVisibilityState.HIDDEN) // Show in input list
    .setCharacteristic(hap.Characteristic.TargetVisibilityState, hap.Characteristic.CurrentVisibilityState.HIDDEN); // Enable show selection
    input
    .getCharacteristic(hap.Characteristic.TargetVisibilityState)
    .on('set', (state, callback) => {
      input.setCharacteristic(hap.Characteristic.CurrentVisibilityState, state);
      callback();
    });
    input
    .getCharacteristic(hap.Characteristic.ConfiguredName)
    .on('set', (name, callback) => { // Rename inout
      callback();
    });
    return input;
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {

    this.log.debug("Logging: ")

    return [
      this.informationService,
      this.tvService,
      this.tvSpeakerService
    ].concat(Object.values(this.inputServices));
  }

}
