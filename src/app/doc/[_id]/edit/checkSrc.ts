import pugInlineTags from "pug-parser/lib/inline-tags";
import type { SourceMapConsumer } from "source-map";
import { blocks } from "@/doc/blocks";
import { roles } from "../DocRender";

interface PugAttribute {
  column: number;
  line: number;
  mustEscape: boolean;
  name: string;
  val: string;
}

interface PugBlock {
  type: "Block";
  line: number;
  nodes: PugTag[];
}
interface PugTag {
  type: "Tag";
  attributeBlocks?: [];
  attrs: PugAttribute[];
  block: PugBlock;
  column?: number;
  isInline: boolean;
  line: number;
  name: string;
  selfClosing: boolean;
}

function nodeWalker(
  node: PugBlock | PugTag,
  cb: (node: PugBlock | PugTag) => void,
) {
  cb(node);
  if (node.type === "Block") {
    node.nodes.forEach((child) => nodeWalker(child, cb));
  }
}

const allowedTags = Object.keys(blocks)
  .concat(["say", "do"])
  .concat(pugInlineTags);

interface CheckSrcError {
  from: { line: number; column: number };
  to: { line: number; column: number };
  message: string;
  severity: "error" | "warning";
}

export function checkSrc(node: PugBlock | PugTag, consumer: SourceMapConsumer) {
  const errors: CheckSrcError[] = [];
  nodeWalker(node, (node) => {
    if (node.type === "Tag") {
      if (!allowedTags.includes(node.name)) {
        let { line, column } = consumer.originalPositionFor({
          line: node.line,
          column: node.column || 0,
        });
        if (line === null) line = node.line;
        if (column === null) column = node.column || 0;

        errors.push({
          from: { line, column },
          to: {
            line,
            column: column + node.name.length,
          },
          message: "Unrecognized tag: " + node.name,
          severity: "warning" as const,
        });
      } else if (
        node.name === "do" ||
        node.name === "say" ||
        node.name == "task"
      ) {
        const roleAttr = node.attrs.find((a) => a.name === "role");
        if (!roleAttr) return;

        const { line, column } = consumer.originalPositionFor({
          line: roleAttr.line,
          column: (roleAttr.column || 0) + roleAttr.name.length + '="'.length,
        });
        if (line === null) {
          console.error("no line");
          return;
        }
        if (column === null) {
          console.error("no column");
          return;
        }

        const role = roleAttr?.val.replace(/^["']|["']$/g, "");
        if (role === "") return;
        let valid = false;
        if (role) {
          if (roles[role]) valid = true;
          else if (["all", "all-officers"].includes(role)) valid = true;
          else {
            const match = role.match(
              /^(?<prefix>all-(officers-)?except-)?(?<roles>.+)$/,
            );
            if (match && match.groups) {
              const prefix = match.groups.prefix || "";
              const exceptRoles = match.groups.roles.split(",");
              if (exceptRoles) {
                let start = prefix.length + 1;
                for (const role of exceptRoles) {
                  if (!roles[role]) {
                    errors.push({
                      from: {
                        line,
                        column: column + start,
                      },
                      to: {
                        line,
                        column: column + start + role.length,
                      },
                      message: "Unrecognized role: " + role,
                      severity: "warning" as const,
                    });
                  }
                  start += role.length + 1;
                }
                return;
              }
            }
          }
        }

        if (!valid) {
          errors.push({
            from: {
              line: roleAttr.line,
              column: (roleAttr.column || 0) + roleAttr.name.length + 1,
            },
            to: {
              line: roleAttr.line,
              column:
                (roleAttr.column || 0) +
                roleAttr.name.length +
                1 +
                roleAttr.val.length,
            },
            message: "Unrecognized role: " + role,
            severity: "warning" as const,
          });
        }
      }
    }
  });
  // console.log(errors);
  return errors;
}
