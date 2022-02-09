/*
    Helper module for controlling Pioneer AVR
*/

import {Logger} from "homebridge";
import EventEmitter from "events";

const request = require('request');
const TelnetAvr = require('./telnet-avr');
const Input = require('./input');

class PioneerAvr extends EventEmitter {

  private readonly log: Logger;
  private readonly host: String;
  private readonly port: Number;
  private readonly state: State;
  private readonly inputs: Map<string, Input> = new Map<string, Input>();
  private readonly telnetAvr: typeof TelnetAvr;
  private initCount: number = 0;
  private isReady: Boolean = false;

  constructor(log: Logger, host: String, port: Number) {
    super();
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
    this.telnetAvr = new TelnetAvr(this.log, this.host, this.port);
    this.registerDataHandler();
  }

  requestInputDefinitions(): void {
    // Queue and send all inputs discovery commands
    this.log.debug('Request input definitions');
    for (var key in Input.inputToType) {
      this.log.debug('Trying Input key: %s', key);
      this.sendCommand(`?RGB${key}`)
    }
  }

  private registerDataHandler(): void {
    const self = this;
    const inputLength = Object.keys(Input.inputToType).length;
    self.telnetAvr.on('data', (data: string) => {
      self.log.debug('Receive data : %s', data);
      // Data returned for input queries
      if (data.startsWith('RGB')) {
        var tmpInput = new Input(
            data.substr(3,2),
            data.substr(6).trim(),
            0); // FIXME type
        self.inputs.set(tmpInput.id, tmpInput);
        if (!this.isReady) {
          self.initCount++;
          self.log.debug('Input [%s] discovered (id: %s, type: %s). InitCount=%s/%s',
              tmpInput.name,
              tmpInput.id,
              tmpInput.type,
              self.initCount,
              inputLength
          );
          if (self.initCount === inputLength) {
            self.isReady = true;
          }
        }
        self.emit('inputDefinition', self.initCount, tmpInput);
      }

      // E06 is returned when input not exists
      if (data.startsWith('E06')) {
        self.log.debug('Receive E06 error');
        if (!this.isReady) {
          self.initCount++;
          self.log.debug('Input does not exists. InitCount=%s/%s',
              self.initCount,
              inputLength
          );
          if (self.initCount === inputLength) {
            self.isReady = true;
          }
        }
      }
    });
  }

  // Send command and process return

  sendCommand(command: string) {
    this.log.debug('Send command : %s', command);
    this.telnetAvr.sendMessage(command);
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
