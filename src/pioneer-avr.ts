/*
    Helper module for controlling Pioneer AVR
*/

import {Logger} from "homebridge";
import EventEmitter from "events";
import {AxiosResponse} from "axios";

const axios = require('axios').default;
const TelnetAvr = require('./telnet-avr');
const Input = require('./input');
const ReadWriteLock = require('rwlock');

class PioneerAvr extends EventEmitter {

  private readonly log: Logger;
  private readonly host: String;
  private readonly port: Number;
  private readonly state: State;
  private readonly inputs: Map<string, Input> = new Map<string, Input>();
  private readonly telnetAvr: typeof TelnetAvr;
  private readonly webStatusUrl: string;
  private readonly webEventHandlerBaseUrl: string;
  private readonly webCommandPattern: RegExp = /^(?:PO|PF|VU|VD|MO|MF|\d+FN)$/;
  private readonly initLock: typeof ReadWriteLock = new ReadWriteLock();

  private webAvailable: boolean = false;
  private inputDefinitionsHandled: number = 0;

  constructor(log: Logger, host: String, port: Number) {
    super();
    this.log = log;
    this.host = host;
    this.port = port;

    // Current AV status
    this.state = new State();

    // Web interface
    this.webStatusUrl = 'http://' + this.host + '/StatusHandler.asp';
    this.webEventHandlerBaseUrl = 'http://' + this.host + '/EventHandler.asp?WebToHostItem=';

    // Register data handler for asynchronous telnet receipts
    this.telnetAvr = new TelnetAvr(this.log, this.host, this.port)
      .on('data', this.handleTelnetData.bind(this));
    this.detectWebAvailability().then(isAvailable => this.webAvailable = isAvailable);
    this.telnetAvr.connect();
    this.requestPowerStatus();
    this.requestInputStatus();
    this.requestVolumeStatus();
    this.requestMuteStatus();
  }

  public shutdown(): void {
    if (this.telnetAvr) {
      this.telnetAvr.disconnect()
      .then(() => this.log.debug("disconnected"));
    }
  }

  private async detectWebAvailability(): Promise<boolean> {
    const self = this;
    self.log.info('Detecting Web API availability: ' + this.webStatusUrl);
    return new Promise<boolean>((resolve: any) =>
        self.initLock.writeLock((releaseLockCallback: any) => {
          axios.get(this.webStatusUrl)
          .then((response: AxiosResponse) => {
            if (response.status === 200) {
              self.log.info('Web API available: ' + response.data);
              self.updateWebStatus(response.data);
              resolve(true);
            } else {
              self.log.info('Web API available: wrong status code ' + response.status);
              resolve(false);
            }
          })
          .catch((err: any) => {
            self.log.warn('Cannot access web API: ' + err);
            resolve(false);
          })
          .finally(() => releaseLockCallback());
        })
    );
  }

  /**
   * parse json:
   * {
   * 	"S": 0,
   * 	"B": 1,
   * 	"Z": [{
   * 		"P": 1,
   * 		"V": 63,
   * 		"M": 0,
   * 		"I": [4, 25, 5, 15, 10, 14, 26, 17, 1, 3, 2, 33],
   * 		"C": 5
   * 	}, {
   * 		"P": 0,
   * 		"V": -1,
   * 		"M": 0,
   * 		"I": [4, 5, 15, 10, 14, 1, 3, 2, 33],
   * 		"C": 4
   * 	}, {
   * 		"P": 0,
   * 		"I": [],
   * 		"C": 4
   * 	}],
   * 	"L": 258,
   * 	"A": -1,
   * 	"IL": ["APPLE TV", "BLURAY", "TV", "UNITYMEDIA", "FireTV", "VIDEO 2", "H.M.G.", "iPod/USB", "VINYL", "CD-R/TAPE", "TUNER", "ADAPTER PORT"],
   * 	"LC": "HM",
   * 	"MA": 0,
   * 	"MS": "0000000",
   * 	"MC": 0,
   * 	"HP": 0,
   * 	"HM": 0,
   * 	"DM": [],
   * 	"H": 1
   * }
   */
  private updateWebStatus(status: any): void {
    if (!status) {
      return;
    }
    this.log.debug("Parsing status: " + JSON.stringify(status));
    let inputList = status.IL;
    if (status.Z && status.Z[0]) {
      let mainZone = status.Z[0];
      this.state.setVolumeAsDb(mainZone.V);
      this.state.muted = mainZone.M === 1;
      if (inputList && mainZone.I) {
        for (let i = 0; i<mainZone.I.length; i++) {
          let key = mainZone.I[i].toString().padStart(2, '0');
          let name = inputList[i].toString();
          let type = Input.inputToType[key];
          this.log.debug(`Found input in JSON: ${key}: ${name}`);
          const inputDefinition = new Input(key, name, type);
          this.inputs.set(inputDefinition.id, inputDefinition);
          this.emit('inputDefinition', 0, inputDefinition);
        }
      }
      this.emit('updateState', this.state);
    }
  }

  public requestInputStatus(): void {
    this.sendCommand('?F');
  }

  public setInput(id: string): void {
    let idPadded = String(id).padStart(2, '0');
    this.sendCommand(`${idPadded}FN`);
  }

  public sendRemoteKey(rk: string): void {
    // Implemented key from CURSOR OPERATION
    switch (rk) {
      case 'UP':
        this.sendCommand('CUP');
        break;
      case 'DOWN':
        this.sendCommand('CDN');
        break;
      case 'LEFT':
        this.sendCommand('CLE');
        break;
      case 'RIGHT':
        this.sendCommand('CRI');
        break;
      case 'ENTER':
        this.sendCommand('CEN');
        break;
      case 'RETURN':
        this.sendCommand('CRT');
        break;
      case 'HOME_MENU':
        this.sendCommand('HM');
        break;
      default:
        this.log.warn('Unhandled remote key : %s', rk);
    }
  }

  public requestPowerStatus(): void {
    this.sendCommand('?P');
  }

  public setPowerOff(): void {
    this.sendCommand('PF');
  }

  public setPowerOn(): void {
    this.sendCommand('PO');
  }

  public requestMuteStatus(): void {
    this.sendCommand('?M');
  }

  public requestPanelLockStatus(): void {
    this.sendCommand('?PKL');
  }

  public setPanelLockOn(): void {
    this.sendCommand('2PKL');
  }

  public setPanelLockOff(): void {
    this.sendCommand('0PKL');
  }

  public setMuteOn(): void {
    this.sendCommand('MO');
  }

  public setMuteOff(): void {
    this.sendCommand('MF');
  }

  public requestVolumeStatus(): void {
    this.sendCommand('?V');
  }

  public setVolume(targetVolumePercent: number): void {
    let vsxVol = Math.floor(targetVolumePercent * 185 / 100);
    let vsxVolStr = String(vsxVol).padStart(3, '0');
    this.sendCommand(`${vsxVolStr}VL`);
  }

  public volumeUp(): void {
    this.sendCommand('VU');
  }

  public volumeDown(): void {
    this.sendCommand('VD');
  }

  public requestInputDefinitions(): void {
    for (let key in Input.inputToType) {
      this.sendCommand(`?RGB${key}`)
    }
  }

  public renameInput(id: string, newName: string): void {
    let shrinkName = newName.substring(0,14);
    this.sendCommand(`${shrinkName}1RGB${id}`);
  }

  // Send command and process return
  private sendCommand(command: string) {
    this.initLock.readLock((releaseLockCallback: any) => {
      try {
        if (this.webCommandPattern.test(command)) {
          return this.sendWebCommand(command)
            .catch((err: any) => this.log.error("Cannot send to web: " + err));
        } else {
          return this.sendTelnetCommand(command);
        }
      } finally {
        releaseLockCallback();
      }
    });
  }

  private sendTelnetCommand(command: string) {
    return this.telnetAvr.queueMessage(command);
  }

  private sendWebCommand(command: string) {
    this.log.debug('Sending via Web API: ' + command);
    return axios.get(this.webEventHandlerBaseUrl + command);
  }

  private handleTelnetData(data: string): void {
    const inputLength = Object.keys(Input.inputToType).length;
    // Data returned for input queries
    // RGB01APPLE TV
    if (data.startsWith('RGB')) {
      let key = data.substring(3,5);
      let type = data.charAt(5);
      let name = data.substring(6).trim();
      const inputDefinition = new Input(key, name, type);
      this.inputs.set(inputDefinition.id, inputDefinition);
      this.inputDefinitionsHandled++;
      this.log.debug('Input [%s] discovered (id: %s, type: %s). InitCount=%s/%s',
          inputDefinition.name,
          inputDefinition.id,
          inputDefinition.type,
          this.inputDefinitionsHandled,
          inputLength
      );
      this.emit('inputDefinition', this.inputDefinitionsHandled, inputDefinition);
    }

    // Power status
    if (data.startsWith('PWR')) {
      this.log.debug('Received Power status : %s', data);
      this.state.on = parseInt(data[3], 10) === 0;
      this.emit('updateState', this.state);
    }

    // Data returned for mute status
    if (data.startsWith('MUT')) {
      this.log.debug('Received Mute status : %s', data);
      this.state.muted = parseInt(data[3], 10) === 0;
      this.emit('updateState', this.state);
    }

    // Data returned for panel lock status
    if (data.startsWith('PKL')) {
      this.log.debug('Received Panel Lock status : %s', data);
      this.state.panelLock = parseInt(data[3], 10) === 0;
      this.emit('updateState', this.state);
    }

    // Data returned for volume status
    if (data.startsWith('VOL')) {
      const vol = parseInt(data.substring(3));
      this.state.setVolumeAsDb(vol);
      this.log.debug("Volume is %s (%s%)", vol, this.state.volume);
      this.emit('updateState', this.state);
    }

    // Data returned for input status
    if (data.startsWith('FN')) {
      this.log.debug('Receive Input status : %s', data);
      let inputId = data.substring(2);
      let inputDefinition = this.inputs.get(inputId);
      if (inputDefinition) {
        this.state.input = inputDefinition;
        this.emit('updateState', this.state);
      }
    }

    // E06 is returned when input not exists
    if (data.startsWith('E06')) {
        this.inputDefinitionsHandled++;
        this.log.debug('Input does not exists. InitCount=%s/%s',
            this.inputDefinitionsHandled,
            inputLength
        );
    }
  }
}

class State {

  private _volume: Number = 0
  private _on: Boolean = false
  private _muted: Boolean = false
  private _panelLock: Boolean = false
  private _input: Input = new Input("00", "unknown", 0);

  get panelLock(): Boolean {
    return this._panelLock;
  }

  set panelLock(value: Boolean) {
    this._panelLock = value;
  }

  get input(): Input {
    return this._input;
  }

  set input(value: Input) {
    this._input = value;
  }
  get muted(): Boolean {
    return this._muted;
  }

  set muted(value: Boolean) {
    this._muted = value;
  }
  get volume(): Number {
    return this._volume;
  }

  set volume(value: Number) {
    this._volume = value;
  }

  setVolumeAsDb(volumeDb: number) {
    const volPctF = Math.floor(volumeDb * 100 / 185);
    this.volume = Math.floor(volPctF);
  }
  get on(): Boolean {
    return this._on;
  }

  set on(value: Boolean) {
    this._on = value;
  }
}

module.exports = PioneerAvr;
