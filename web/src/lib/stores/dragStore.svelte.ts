export interface DragData {
  type: "parameter" | "group-item" | "group" | "tab";
  data: any;
  sourceType?: string;
}

class DragStore {
  private _data = $state<DragData | null>(null);

  get current() {
    return this._data;
  }

  set(data: DragData | null) {
    this._data = data;
  }

  clear() {
    this._data = null;
  }
}

export const dragStore = new DragStore();
