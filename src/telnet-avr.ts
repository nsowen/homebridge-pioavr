'use strict';

import {Logger} from "homebridge/lib/logger";
import EventEmitter from "events";

const {Telnet} = require('telnet-client')
const ReadWriteLock = require('rwlock');

const sendOpts = {
  negotiationMandatory: false,
  shellPrompt: null
};

class TelnetAvr extends EventEmitter {

  private readonly host: string;
  private readonly port: number;
  private readonly lock: typeof ReadWriteLock;
  private readonly telnet: typeof Telnet;
  private connected: boolean = false;
  private initialized: boolean = false;
  private logger: Logger;
  private queue: string[] = [];

  constructor(logger: Logger, host: string, port: number) {
    super();
    this.logger = logger;
    this.host = host;
    this.port = port;
    this.lock = new ReadWriteLock();
    this.telnet = new Telnet();
  }

  public async disconnect(): Promise<void> {
    if (!this.telnet || !this.connected) {
      return Promise.resolve();
    }
    this.lock.writeLock((releaseLockCallback: any) => {
      return this.telnet.end()
        .finally(() => releaseLockCallback());
    });
  }

  public async connect(): Promise<void> {
    return new Promise<void>((resolve: any, reject: any) => {
      this.lock.writeLock((releaseLockCallback: any) => {
        const self = this;

        if (this.connected) {
          releaseLockCallback();
          resolve();
          return;
        }

        if (!this.initialized) {

          this.telnet.on('timeout', () => {
            self.logger.debug(`Connection timeout for ${this.host}:${this.port}`);
            this.emit('timeout', this.host, this.port);
          })

          this.telnet.on('error', (err: any) => {
            self.logger.warn(`Connection error for  ${this.host}:${this.port}: ${err}`);
          });

          this.telnet.on('close', () => {
            self.logger.debug(`Connection closed for  ${this.host}:${this.port}`);
            self.connected = false;
            this.emit('disconnected', this.host, this.port);
          })

          this.telnet.on('end', () => {
            self.logger.debug(`Connection ended for  ${this.host}:${this.port}`);
            self.connected = false;
            this.emit('disconnected', this.host, this.port);
          })

          this.telnet.on('data', (d: any) => {
            let data = d
            .toString()
            .split('\r\n')
            .map((value: string) => value.replace(/[\r\n]/g, '').trim())
            .filter((value: string) => value && value.length > 0);
            if (data) {
              self.logger.debug(`Connection data from  ${this.host}:${this.port}: ${data}`);
              data.forEach((line: string) => this.emit('data', line))
            }
          })

          this.initialized = true;
        }

        // connect to endpoint and hook in with once listener
        this.logger.debug(`Connecting to  ${self.host}:${self.port}`);
        this.telnet.once('connect', () => {
          this.logger.debug(`Connected to  ${self.host}:${self.port}`);
          self.connected = true;
          this.emit('connected', self.host, self.port);
          this.queueMessage('');
          // this.triggerKeepAlive();
          releaseLockCallback();
          resolve();
        });
        this.telnet.connect({
          port: self.port,
          host: self.host,
          negotiationMandatory: false,
          irs: '\r\n',
          ors: '\r',
          timeout: 800,
        }).catch((error: any) => {
          // retry in 10 secs
          releaseLockCallback();
          setTimeout(() => this.connect(), 10000);
        });
      });
    });
  }

  queueMessage(message: string): void {
    if (message) {
      this.queue.push(message);
    }
    if (this.queue.length > 0) {
      this.drain();
    }
  }

  private drain(): void {
    // early return if queue is empty
    if (this.queue.length == 0 || !this.connected) {
      return;
    }

    // at least one message to send
    let queuedMessage = this.queue.shift();
    this.logger.debug('Sending via telnet: ' + queuedMessage);
    this.telnet.send(queuedMessage, sendOpts)
    .catch((sendErr: any) => this.logger.warn('Sending: ' + queuedMessage + ' failed: ' + sendErr));

    // repeat until empty, but wait 100ms first
    if (this.queue.length > 0) {
      setTimeout(() => this.drain(), 100);
    }
  }
}

module.exports = TelnetAvr;
