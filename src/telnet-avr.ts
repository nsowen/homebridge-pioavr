'use strict';

import {Logger} from "homebridge";

const { Telnet } = require('telnet-client')
const ReadWriteLock = require('rwlock');

const PORT = 23;
const HOST = '127.0.0.1';

class TelnetAvr {

  private readonly host: string;
  private readonly port: number;
  private readonly lock: typeof ReadWriteLock;
  private keepAliveEnabled: boolean = true;
  private readonly telnet: typeof Telnet;
  private connected: boolean = false;
  private initialized: boolean = true;
  private releaseLockCallback: any;
  private logger: Logger;

  constructor(logger: Logger, host: string, port: number) {
    this.logger = logger;
    this.host = host || HOST;
    this.port = port || PORT;
    this.lock = new ReadWriteLock();
    this.telnet = new Telnet();
    this.connectTelnet();
  }

  connectTelnet() {
    this.lock.writeLock((releaseLockCallback: any) => {
      const self = this;

      if (this.connected) {
        return;
      }

      if (!this.initialized) {
        this.telnet.on('timeout', () => {
          self.logger.debug(`Connection timeout for ${this.host}:${this.port}`);
        })
        this.telnet.on('close', () => {
          self.logger.debug(`Connection closed for  ${this.host}:${this.port}`);
          self.connected = false;
        })
        this.telnet.on('data', (data: any) => {
          self.logger.debug(`Connection data from  ${this.host}:${this.port}: ${data}`);
        })
        this.initialized = true;
      }

      this.logger.debug(`Connecting to  ${self.host}:${self.port}`);
      this.telnet.once('connect', () => {
        self.connected = true;
        releaseLockCallback();
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
      self.write('').then((data: string) => {
        this.logger.debug('got keepalive response: ' + data);
        self.triggerKeepAlive(); // retrigger
      });
    }, 3000);
  }

  async write(message: string) {
    const self = this;
    return new Promise<string>((resolve, reject) => {
      self.lock.writeLock((release: any) => {
        this.logger.debug('got lock, sending <' + message + '>');
        self.telnet.send(message, {
          ors: '\r\n',
          timeout: 0
        }, () => {
          console.log('done sending')
          self.telnet.nextData().then((raw: any) => {
            console.log('got data: ' + raw);
            const data = raw.toString()
            .replace('\n', '')
            .replace('\r', '');
            self.logger.debug('got data: ' + data);
            release();
            // this.logger.debug('released lock and resolve');
            resolve(data);
          });
        });
      })
    });
  }

  async sendMessage(message: string, callback: any, callbackError: any) {
    this.logger.debug('in method: ' + message);
    // await self.write(''); // sent empty and wait
    // require('deasync').sleep(100);
    const response = await this.write(message);
    this.logger.debug("got promise: " + response);
    callback(response);
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
var test = new TelnetAvr("192.168.178.28", 23);

for (var i=1; i<9; i++) {
  test.sendMessage("?RGB0" + i)
  .then(value => {
    this.logger.debug('got callback: ' + value);
  }).catch(error => {
    this.logger.debug('got error: ' + error);
  });
}

this.logger.debug('Do something else');
 */

module.exports = TelnetAvr;
