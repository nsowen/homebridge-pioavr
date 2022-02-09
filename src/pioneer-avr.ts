/*
    Helper module for controlling Pioneer AVR
*/

import {Logger} from "homebridge";

const request = require('request');
const TelnetAvr = require('./telnet-avr');
const Input = require('./input');

// Reference fot input id -> Characteristic.InputSourceType
const inputToType = {
  '00': 0, // PHONO -> Characteristic.InputSourceType.OTHER
  '01': 0, // CD -> Characteristic.InputSourceType.OTHER
  '02': 2, // TUNER -> Characteristic.InputSourceType.TUNER
  '03': 0, // TAPE -> Characteristic.InputSourceType.OTHER
  '04': 0, // DVD -> Characteristic.InputSourceType.OTHER
  '05': 3, // TV -> Characteristic.InputSourceType.HDMI
  '06': 3, // CBL/SAT -> Characteristic.InputSourceType.HDMI
  '10': 4, // VIDEO -> Characteristic.InputSourceType.COMPOSITE_VIDEO
  '12': 0, // MULTI CH IN -> Characteristic.InputSourceType.OTHER
  '13': 0, // USB-DAC -> Characteristic.InputSourceType.OTHER
  '14': 6, // VIDEOS2 -> Characteristic.InputSourceType.COMPONENT_VIDEO
  '15': 3, // DVR/BDR -> Characteristic.InputSourceType.HDMI
  '17': 9, // USB/iPod -> Characteristic.InputSourceType.USB
  '18': 2, // XM RADIO -> Characteristic.InputSourceType.TUNER
  '19': 3, // HDMI1 -> Characteristic.InputSourceType.HDMI
  '20': 3, // HDMI2 -> Characteristic.InputSourceType.HDMI
  '21': 3, // HDMI3 -> Characteristic.InputSourceType.HDMI
  '22': 3, // HDMI4 -> Characteristic.InputSourceType.HDMI
  '23': 3, // HDMI5 -> Characteristic.InputSourceType.HDMI
  '24': 3, // HDMI6 -> Characteristic.InputSourceType.HDMI
  '25': 3, // BD -> Characteristic.InputSourceType.HDMI
  '26': 10, // MEDIA GALLERY -> Characteristic.InputSourceType.APPLICATION
  '27': 0, // SIRIUS -> Characteristic.InputSourceType.OTHER
  '31': 3, // HDMI CYCLE -> Characteristic.InputSourceType.HDMI
  '33': 0, // ADAPTER -> Characteristic.InputSourceType.OTHER
  '34': 3, // HDMI7-> Characteristic.InputSourceType.HDMI
  '35': 3, // HDMI8-> Characteristic.InputSourceType.HDMI
  '38': 2, // NETRADIO -> Characteristic.InputSourceType.TUNER
  '40': 0, // SIRIUS -> Characteristic.InputSourceType.OTHER
  '41': 0, // PANDORA -> Characteristic.InputSourceType.OTHER
  '44': 0, // MEDIA SERVER -> Characteristic.InputSourceType.OTHER
  '45': 0, // FAVORITE -> Characteristic.InputSourceType.OTHER
  '48': 0, // MHL -> Characteristic.InputSourceType.OTHER
  '49': 0, // GAME -> Characteristic.InputSourceType.OTHER
  '57': 0 // SPOTIFY -> Characteristic.InputSourceType.OTHER
};

class PioneerAvr {

  private readonly log: Logger;
  private readonly host: String;
  private readonly port: Number;
  private readonly state: State;
  private readonly inputs: Map<string, Input> = new Map<string, Input>();
  private readonly telnet: typeof TelnetAvr;
  private initCount: number = 0;
  private isReady: Boolean = false;

  constructor(log: Logger, host: String, port: Number) {
    const me = this;
    this.log = log;
    this.host = host;
    this.port = port;

    // Current AV status
    this.state = new State();

    // Web interface ?

    /*
        this.web = false;
    this.webStatusUrl = 'http://' + this.host + '/StatusHandler.asp';
    this.webEventHandlerBaseUrl = 'http://' + this.host + '/EventHandler.asp?WebToHostItem=';
    request
        .get(this.webStatusUrl)
        .on('response', function(response) {
            if (response.statusCode == '200') {
                me.log.info('Web Interface enabled');
                this.web = true;
            }
        });
    */
    // Communication Initialization
    this.telnet = new TelnetAvr(this.log, this.host, this.port);
  }

  loadInputs(callback: any) {
    // Queue and send all inputs discovery commands
    this.log.debug('Discovering inputs');
    for (var key in inputToType) {
      this.log.debug('Trying Input key: %s', key);
      this.sendCommand(`?RGB${key}`, callback)
    }
  }

// Send command and process return

  async sendCommand(command: string, callback: any) {
    // Main method to send a command to AVR
    this.log.debug('Send command : %s', command);
    this.telnet.sendMessage(command, (data: string) => {
      this.log.debug('Receive data : %s', data);
      // Data returned for input queries
      if (data.startsWith('RGB')) {
        var tmpInput = new Input(
            data.substr(3,2),
            data.substr(6).trim(),
            0); // FIXME type
        this.inputs.set(tmpInput.id, tmpInput);
        if (!this.isReady) {
          this.initCount++;
          this.log.debug('Input [%s] discovered (id: %s, type: %s). InitCount=%s/%s',
              tmpInput.name,
              tmpInput.id,
              tmpInput.type,
              this.initCount,
              Object.keys(inputToType).length
          );
          if (this.initCount === Object.keys(inputToType).length) this.isReady = true;
        }
        callback(this.initCount, tmpInput);
      }

      // E06 is returned when input not exists
      if (data.startsWith('E06')) {
        this.log.debug('Receive E06 error');
        if (!this.isReady) {
          this.initCount++;
          this.log.debug('Input does not exists. InitCount=%s/%s',
              this.initCount,
              Object.keys(inputToType).length
          );
          if (this.initCount === Object.keys(inputToType).length) this.isReady = true;
        }
      }
    }, (error: any) => {
      this.log.error('Error: ' + error);
    });

    /*
    return this.telnet.sendMessage(command)
      .then((data: any) => {

      }).catch((error: any) => {
        this.log.error('Error: ' + error)
      });
     */
  }
}

class State {

  private _volume: Number = 0
  private _on: Boolean = false
  private _muted: Boolean = false
  private _input: Input = new Input("00", "unknown", 0);

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
  get on(): Boolean {
    return this._on;
  }

  set on(value: Boolean) {
    this._on = value;
  }
}

module.exports = PioneerAvr;
