import _angelicOrders from "./angelicOrders.json5" with { type: "json" };

type AngelicOrderId =
  | "chayot-hakodesh"
  | "auphanim"
  | "aralim"
  | "chashmalim"
  | "seraphim"
  | "malachim"
  | "elohim"
  | "bnei-elohim"
  | "kerubim"
  | "ishim";

type LangObject = { he: string; en: string; roman: string };

interface AngelicOrder {
  id: AngelicOrderId;
  name: LangObject;
}

type AngelicOrders = Record<AngelicOrderId, AngelicOrder>;

const angelicOrders: AngelicOrders = _angelicOrders as AngelicOrders;

export type { AngelicOrder, AngelicOrderId, AngelicOrders };
export default angelicOrders;
