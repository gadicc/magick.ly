import pugLex from "pug-lexer";
import pugParse from "pug-parser";
import { transformAndMapShortcuts } from "./shortcuts";

export function prepare(src) {
  const { transformed } = transformAndMapShortcuts(src);
  return toJrt(pugParse(pugLex(transformed), { src: transformed }));
}

// const tokens = lex(_neophyte);
// const ast = parse(tokens, { src: _neophyte });

export function toJrt(ast) {
  const out = {};

  // if (ast.type === "Block") return ast.nodes.map(toJrt);
  //
  if (ast.type === "Tag") {
    if (ast.name === "say") {
      out.type = "task";
      out.say = true;
    } else if (ast.name === "do") {
      out.type = "task";
      out.do = true;
    } else {
      out.type = ast.name;
    }

    for (let { name, val } of ast.attrs) {
      if (typeof val === "string") {
        if (val === "false") out[name] = false;
        else if (val === "true") out[name] = true;
        else out[name] = val.replace(/^['"]+|['"]+$/g, "");
      } else out[name] = val;
    }
  } else if (ast.type === "Text") {
    out.type = "text";
    out.value = ast.val;
  }

  if (ast.nodes) out.children = ast.nodes.map(toJrt);
  if (ast.block) out.children = ast.block.nodes.map(toJrt);
  return out;
}

// console.log(JSON.stringify(ast, null, "  "));
// console.log(JSON.stringify(toJrt(ast), null, "  "));

//const origDoc = { children: neophyte };
// const origDoc = toJrt(ast);
