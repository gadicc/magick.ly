import { pageMetadata } from "@/seo/metadata";
import Candlestick from "./candlestick";

export const metadata = pageMetadata("/gd/symbols/candlestick");

export default function CandlestickPage() {
  return <Candlestick />;
}
