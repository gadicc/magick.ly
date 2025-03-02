import React from "react";
import { Node, Render } from "json-rich-text";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import DocContext from "../../src/doc/context.js";
import { roleAliases } from "@/app/doc/[_id]/DocRender";

class Title extends Node {
  render(key) {
    return (
      <Paper key={key} sx={{ p: 1, mb: 1, background: "#fff" }}>
        <a name={this.block.text.replace(/ /g, "_")}></a>
        <Typography variant="h5">
          {(this.children && this.renderChildren()) ||
            this.block.value ||
            this.block.text}
        </Typography>
      </Paper>
    );
  }
}

class Grade extends Node {
  render(key) {
    const parts = this.block.grade.split("=");

    return (
      <span
        key={key}
        className="grade"
        style={{
          display: "inline-block",
          position: "relative",
          textIndent: "0px",
        }}
      >
        {/* eslint-disable-next-line react/no-unknown-property */}
        <style jsx global>{`
          [style*="font-style: italic"] .grade {
            // Doesn't seem to work with descendant selectors
            color: red;
          }
          .note .grade,
          .do .grade {
            transform: skew(-20deg);
            font-style: normal;
          }
        `}</style>
        <style jsx>{`
          .circled {
            border: 1px solid;
            border-radius: 50%;
            width: 2.5ch;
            display: inline-block;
            text-align: center;
          }
          .squared {
            border: 1px solid;
            width: 2.5ch;
            display: inline-block;
            text-align: center;
          }
          .equals {
            padding: 0 5px 0 5px;
          }
        `}</style>
        <span className="circled">{parts[0]}</span>
        <span className="equals">=</span>
        <span className="squared">{parts[1]}</span>
      </span>
    );
  }
}

class Todo extends Node {
  //type: "todo";

  render(key) {
    return <div key={key}>(TODO: {this.renderChildren()})</div>;
  }
}

class B extends Node {
  render(key) {
    return <b key={key}>{this.renderChildren()}</b>;
  }
}

class I extends Node {
  render(key) {
    return <i key={key}>{this.renderChildren()}</i>;
  }
}

class Img extends Node {
  render(key) {
    const style = this.block.style ? JSON.parse(this.block.style) : {};
    if (!style.width && !this.block.style) style.width = "100%";

    return (
      // eslint-disable-next-line
      <img
        key={key}
        width={this.block.width}
        height={this.block.height}
        style={style}
        src={this.block.src}
      />
    );
  }
}

class Br extends Node {
  render(key) {
    return <br key={key} />;
  }
}

class ul extends Node {
  render(key) {
    return <ul key={key}>{this.renderChildren()}</ul>;
  }
}

class ol extends Node {
  render(key) {
    return <ol key={key}>{this.renderChildren()}</ol>;
  }
}

class li extends Node {
  render(key) {
    return <li key={key}>{this.renderChildren()}</li>;
  }
}

class hr extends Node {
  render(key) {
    return <hr />;
  }
}

class Var extends Node {
  render(key) {
    // eslint-disable-next-line
    const context = React.useContext(DocContext);
    const variable = context.vars[this.block.name];
    return (
      <span key={key}>
        {variable ? variable.value : `NO SUCH VARIABLE "${this.block.name}"`}
      </span>
    );
  }
}

class DeclareVar extends Node {
  render(key) {
    return null;
  }
}

class Note extends Node {
  render(key) {
    return (
      <Paper
        key={key}
        className="note"
        style={{ fontStyle: "italic" }}
        sx={{ p: 1, mb: 1, mx: 2.5, background: "#f4f4f4" }}
      >
        {this.renderChildren()}
      </Paper>
    );
  }
}

class Summary extends Node {
  render(key) {
    return (
      <details key={key}>
        <summary>{this.block.summary}</summary>
        {this.renderChildren()}
      </details>
    );
  }
}

class Task extends Node {
  //type: "todo";

  render(key) {
    const block = this.block;
    // eslint-disable-next-line
    const context = React.useContext(DocContext);
    const vars = context.vars;
    const roles = context.roles;
    // console.log({ myRole: vars.myRole.value });

    /*
      let roles;
      if (typeof this.block.role === "string") roles = [block.role];
      else if (Array.isArray(block.role)) roles = block.role;
      else if (typeof block.role === "object") {
        // TODO
        roles = ["all (except: " + block.role["all-except"] + ")"];
      } else
        throw new Error("Unknown role type: " + JSON.stringify(block.role));
      */
    const myRole = (function () {
      const role = vars.myRole?.value; // "hierophant"
      return roleAliases[role] || role;
    })();

    let forMe,
      role = block.role;

    if (role === myRole || role === "all") forMe = true;
    else if (role === "all-officers")
      forMe = !["candidate", "member"].includes(myRole);
    else if (role.startsWith("all-except-"))
      forMe = !role.substr(11).split(",").includes(myRole);
    else if (role.startsWith("all-officers-except-"))
      forMe =
        !["candidate", "member"].includes(myRole) &&
        !role.substr(20).split(",").includes(myRole);
    else if (role.match(",")) forMe = role.split(",").includes(myRole);

    /*
    // we show this in the builtin editor now anyway
    if (!["all-officers", "all"].includes(role)) {
      const roles = role
        // all-except-XXX, all-officers-except-XXX
        .replace(/^all.*-except-/, "")
        .split(",");
      for (const role of roles)
        if (!context.roles[role])
          console.log(
            "%c Invalid role: " + role,
            "background: #ffa",
            this.block
          );
    }
    */

    const samePreviousRole = this.prev() && this.prev().block.role === role;

    // eslint-disable-next-line
    const ref = React.useRef();
    // eslint-disable-next-line
    React.useEffect(() => {
      this.block.ref = ref;
      this.block.forMe = forMe;
      return () => {
        delete this.block.ref;
        delete this.block.forMe;
      };
    });

    function renderChildren(node, children) {
      return children ? children.map((child, i) => child.render(i)) : null;
    }

    return (
      <div key={key} ref={ref}>
        <Paper
          sx={{
            px: 2,
            pt: 1,
            pb: 1,
            mb: 1.6,
            mt: samePreviousRole ? -1.0 : 0,
            ml: forMe ? 5 : 0,
            mr: forMe ? 0 : 5,
            background: forMe && "#d9fdd3",
            position: "relative",
          }}
        >
          <style jsx>{`
            .say::before {
              content: open-quote;
              font-size: 120%;
            }
            .say::after {
              content: close-quote;
              font-size: 120%;
            }
            .say {
              quotes: "“" "”" "‘" "’";
              text-indent: -0.45em;
              margin-block-start: 0;
              margin-block-end: 0.5em;
              margin-inline-start: 5px;
              margin-inline-end: 0;
            }
            .do {
              font-style: italic;
            }
            .do::before {
              content: "*";
            }
            .do::after {
              content: "*";
            }
            .role {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              /* margin-bottom: 5px; */
            }
            .role > div {
              height: 100%;
              display: inline-block;
            }
            .roleSymbol > * {
              margin-right: 3px;
              vertical-align: top;
            }
            .roleName {
              vertical-align: top;
            }
            .pg {
              position: absolute;
              right: 8px;
              top: 6px;
              color: #ddd;
            }
          `}</style>
          {
            /* role !== myRole && */ !samePreviousRole && (
              <div className="role">
                <div className="roleSymbol">
                  {role.split(",").map((role, i) => (
                    <span key={i}>{roles[role]?.symbol}</span>
                  ))}
                </div>{" "}
                <div className="roleName">
                  {role.split(",").map((role, i) => (
                    <span
                      key={i}
                      style={{ color: roles[role]?.color, marginRight: 3 }}
                    >
                      {roles[role]?.name ||
                        role.substr(0, 1).toUpperCase() + role.substr(1)}
                    </span>
                  ))}
                </div>
              </div>
            )
          }
          <span className="pg">{key}</span>
          {block.say && (
            <div className="say">
              {renderChildren(
                this,
                this.children.filter((node) => node.block.type != "footnotes")
              )}
            </div>
          )}
          {block.do && (
            <div className="do">
              {renderChildren(
                this,
                this.children.filter((node) => node.block.type != "footnotes")
              )}
            </div>
          )}
          {(() => {
            let footnotes = this.children.find(
              (node) => node instanceof Footnotes
            );

            // This section needs to happen after renderChildren above, otherwise
            // this.footnotes won't exist yet.
            if (!footnotes && this.footnotes) {
              footnotes = new Footnotes({ type: "footnotes" });
              footnotes.footnotes = this.footnotes;
              // console.log(2, { footnotes });
            }

            return footnotes && footnotes.render();
          })()}
        </Paper>
      </div>
    );
  }
}

class Footnote extends Node {
  render(key) {
    let footnotes = null;
    for (let parent = this.parent; parent; parent = parent.parent) {
      for (const child of parent.children) {
        // or child.block.type === "footnotes"
        if (child instanceof Footnotes) {
          footnotes = child;
          break;
        }
      }
      if (footnotes) break;
      if (parent instanceof Task) {
        footnotes = parent;
        break;
      }
    }

    let location = "";
    if (footnotes) {
      if (!footnotes.footnotes) footnotes.footnotes = [];
      location = footnotes.footnotes.indexOf(this);
      if (location === -1) {
        footnotes.footnotes.push(this);
        location = 0;
      }
    }
    // console.log({ footnotes });

    return <sup key={key}>{location + 1}</sup>;
  }
}

class Footnotes extends Node {
  render(key) {
    return (
      <details key={key}>
        <style jsx>{`
          details {
            margin-top: 15px;
          }
          ol {
            padding-inline-start: 15px;
          }
          ol li {
            text-indent: 0px;
          }
        `}</style>
        <summary>Footnotes</summary>
        <ol>
          {this.footnotes.map((footnote, i) => (
            <li key={i}>{footnote.renderChildren()}</li>
          ))}
        </ol>
      </details>
    );
  }
}

class Stylesheet extends Node {
  render(key) {
    return <link key={key} rel="stylesheet" href={this.block.href} />;
  }
}

class A extends Node {
  render(key) {
    const valid = this.block.href && this.block.href.startsWith("http");
    return valid ? (
      <a key={key} href={this.block.href} target="_blank">
        {this.renderChildren()}
      </a>
    ) : (
      <span
        key={key}
        style={{ textDecoration: "red underline" }}
        title={"Blocked href to " + this.block.href}
      >
        {this.renderChildren()}
      </span>
    );
  }
}

class Span extends Node {
  render(key) {
    const { type, children, ..._attrs } = this.block;
    const attrs = _attrs || {};
    // console.log("span", attrs);

    return (
      <span
        key={key}
        {...attrs}
        style={
          attrs.style &&
          JSON.parse(
            // https://stackoverflow.com/a/34763398/1839099
            attrs.style.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ')
          )
        }
      >
        {this.renderChildren()}
      </span>
    );
  }
}

export const blocks = {
  a: A,
  b: B,
  i: I,
  br: Br,
  img: Img,
  ul,
  ol,
  li,
  hr,
  span: Span,
  stylesheet: Stylesheet,

  note: Note,
  task: Task,
  title: Title,
  todo: Todo,

  var: Var,
  declareVar: DeclareVar,
  summary: Summary,
  footnote: Footnote,
  footnotes: Footnotes,

  grade: Grade,
};
Node.registerBlocks(blocks);

// NB: If we don't export "Node", React fast refresh won't pickup Component
// changes.
export { Node, Render };
