import { Fragment } from "react";
import { privateMetadata } from "@/seo/metadata";
import Lamen from "./lamen";

export const metadata = privateMetadata("Officer Lamens");

export default function GDComponentTest() {
  return [
    "imperator",
    "praemonstrator",
    "cancellarius",
    "hierophant",
    "hegemon",
    "hiereus",
    "dadouchos",
    "stolistes",
    "keryx",
    "sentinel",
  ].map((officer) => (
    <Fragment key={officer}>
      <Lamen officer={officer} />
      <br />
    </Fragment>
  ));
}
