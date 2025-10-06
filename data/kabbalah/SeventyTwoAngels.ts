import _angels from "./seventyTwoAngels.json5" with { type: "json" };

interface Angel {
  name: { en: string; he: string };
  text: { en: string; fr: string };
  attribute: { en: string };
  presidesOver: [number, number][];
  godName?: string;
  angelicOrderId: string;
  // angelicOrder: AngelicOrder;
}

type Angels = Angel[];

const angels: Angels = _angels as Angels;

export type { Angel, Angels };
export default angels;
