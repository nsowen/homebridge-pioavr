class Input {

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
