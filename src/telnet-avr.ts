'use strict';

import {Logger} from "homebridge/lib/logger";
import EventEmitter from "events";

const { Telnet } = require('telnet-client')
const ReadWriteLock = require('rwlock');

const PORT = 23;
const HOST = '127.0.0.1';

const sendOpts = {
  negotiationMandatory: false
};

class TelnetAvr extends EventEmitter {

  private readonly host: string;
  private readonly port: number;
  private readonly lock: typeof ReadWriteLock;
  private keepAliveEnabled: boolean = true;
  private readonly telnet: typeof Telnet;
  private connected: boolean = false;
  private initialized: boolean = false;
  private logger: Logger;

  constructor(logger: Logger, host: string, port: number) {
    super();
    this.logger = logger;
    this.host = host || HOST;
    this.port = port || PORT;
    this.lock = new ReadWriteLock();
    this.telnet = new Telnet();
  }

  public connect(): void {
    this.lock.writeLock((releaseLockCallback: any) => {
      const self = this;

      if (this.connected) {
        return;
      }

      if (!this.initialized) {
        this.telnet.on('timeout', () => {
          self.logger.debug(`Connection timeout for ${this.host}:${this.port}`);
          this.emit('timeout', this.host, this.port);
        })
        this.telnet.on('close', () => {
          self.logger.debug(`Connection closed for  ${this.host}:${this.port}`);
          self.connected = false;
          this.emit('disconnected', this.host, this.port);
        })
        this.telnet.on('data', (d: any) => {
          let data = d
          .toString()
          .replace('\n', '')
          .replace('\r', '');
          self.logger.debug(`Connection data from  ${this.host}:${this.port}: ${data}`);
          this.emit('data', data);
        })
        this.initialized = true;
      }

      this.logger.debug(`Connecting to  ${self.host}:${self.port}`);
      this.telnet.once('connect', () => {
        self.connected = true;
        releaseLockCallback();
        this.emit('connected', self.host, self.port);
        this.triggerKeepAlive();
      });
      this.telnet.connect({
          port: self.port,
          host: self.host,
          negotiationMandatory: false,
          timeout: 0,
          irs: '\r\n',
          ors: '\r\n'
      });
    })
  }

  triggerKeepAlive() {
    const self = this;
    setTimeout(() => {
      if (!self.keepAliveEnabled) {
        return;
      }
      self.telnet.send('', sendOpts)
      .then((data: any) => {
        self.emit('keepalive', self.host, self.port);
        self.triggerKeepAlive(); // retrigger
      });
    }, 3000);
  }

  sendMessage(message: string) {
    this.connect();
    this.logger.debug('Sending: ' + message);
    this.telnet.send('', sendOpts);
    require('deasync').sleep(100);
    return this.telnet.send(message, sendOpts);
  }

/*
  async sendMessage(message: string): Promise<string> {
    var me = this;
    return new Promise(function(resolve, reject) {
      me.lock.writeLock(function (release: any) {

        const socket = net.Socket();
        socket.setTimeout(2000, () => {
          socket.destroy();
        });

        socket.once('connect', () => {
          socket.setTimeout(0);
        });

        socket.connect(me.port, me.host, () => {
          socket.write(message + '\r');
          deasync.sleep(100);
          socket.write(message + '\r');
          if (!message.startsWith('?')) {
            socket.end();
            resolve(message + ':SENT');
          }
        });

        socket.on('close', () => {
          deasync.sleep(100);
          release();
        });

        socket.on('data', (d: any) => {
          let data = d
          .toString()
          .replace('\n', '')
          .replace('\r', '');
          this.logger.debug('resolving: ' + data);
          resolve(data);
          socket.end();
        });

        socket.on('error', (err: any) => {
          reject(err);
        });
      });
    });
  }
   */
}

/*
Logger.setDebugEnabled(true);
var test = new TelnetAvr(new Logger("test"), "192.168.178.28", 23)
  .on('data', (data: any) => {
    console.log('hello: ' + data);
  }).on('connected', () => console.log('connected'));

test.sendMessage('?RGB10');
 */


module.exports = TelnetAvr;
