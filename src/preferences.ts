
const fs = require('fs');

import {Logger} from "homebridge";

export interface Preferences {
  inputVisibilities: { [key: string]: boolean };
}

class PreferencesAccessor {

  private readonly storagePath: string;
  private readonly logger: Logger;
  private readonly filename: string;

  constructor(logger: Logger, storagePath: string) {
    this.logger = logger;
    this.storagePath = storagePath;
    this.filename = this.storagePath + '/homebridge-pioavr-prefs.json';
  }

  private getPreferences(): Preferences {
    try {
      let data = JSON.parse(fs.readFileSync(this.filename));
      this.logger.info("Read prefs: " + JSON.stringify(data));
      return data;
    } catch (error: any) {
      // create new
      return { inputVisibilities: {} };
    }
  }

  private async savePreferences(prefs: Preferences): Promise<void> {
    return new Promise<void>((resolve: any, reject: any) => {
      try {
        let data = JSON.stringify(prefs);
        this.logger.info('saving preferences %s to %s', data, this.filename);
        fs.writeFile(this.filename, data, (err: any) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (error) {
        this.logger.error('error: %s: %s', this.filename, error);
        reject(error);
      }
    });
  }

  public async setInputHidden(key: string, state: boolean): Promise<void> {
    let prefs = this.getPreferences();
    this.logger.info("Got prefs: " + JSON.stringify(prefs));
    if (prefs.inputVisibilities) {
      prefs.inputVisibilities[key] = state;
      return this.savePreferences(prefs);
    } else {
      this.logger.warn("Invalid preferences, cannot save");
    }
  }

  public isInputHidden(key: string): boolean {
    let prefs = this.getPreferences();
    if (prefs && prefs.inputVisibilities) {
      let state = prefs.inputVisibilities[key] as boolean;
      return state;
    }
    return true;
  }

}

module.exports = PreferencesAccessor;
