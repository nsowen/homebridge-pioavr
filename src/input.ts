
class Input {

  // Reference fot input id -> Characteristic.InputSourceType
  public static readonly inputToType: { [key: string]: number } = {
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

  private readonly _id: string;
  private readonly _name: string;
  private readonly _type: number;

  constructor(id: string, name: string, type: number) {
    this._id = id;
    this._name = name;
    this._type = type;
  }

  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get type(): number {
    return this._type;
  }
}

module.exports = Input;
