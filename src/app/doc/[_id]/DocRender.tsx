"use client";

/*
WHERE?
You are loading @emotion/react when it is already loaded. Running multiple
instances may cause problems. This can happen if multiple versions are used,
or if multiple builds of the same version are used.
*/

import {
  Add as AddIcon,
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
  List as ListIcon,
  Remove as RemoveIcon,
  ZoomIn as ZoomInIcon,
} from "@mui/icons-material";
import {
  Box,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Popover,
  Select,
  Slide,
  SpeedDial,
  SpeedDialAction,
  Stack,
  TextField,
  useScrollTrigger,
} from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { Render } from "@/doc/blocks";

import DocContext from "@/doc/context";
import { DocNode } from "@/schemas";
import "@/../public/fonts/FrankRuehlCLM-stylesheet.css";
import Lamen from "@/app/gd/components/lamen";

// Note: make sure not to export anything except the react component
// in this file, otherwise React Fast Refresh will need to do a
// Full Reload.

function _PraemonstratorWand({ size }) {
  return (
    <svg
      version="1.1"
      id="svg1981"
      width={size}
      height={size}
      viewBox="0 0 600 600"
    >
      <g
        id="g1987"
        transform="matrix(3.7795276,0,0,3.7795276,-78.450732,-145.97385)"
        style={{
          fillRule: "evenodd",
          stroke: "#000000",
          strokeWidth: 4,
          strokeLinecap: "butt",
          strokeLinejoin: "miter",
          strokeDasharray: "none",
          strokeOpacity: 1,
        }}
      >
        <path
          style={{ fill: "#a02c2c" }}
          d="M 21.289256,180.58781 V 57.347003 l 77.802218,60.829677 z"
          id="path377-7"
        />
        <path
          style={{ fill: "#ffcc00" }}
          d="M 37.974882,39.154747 H 161.21579 L 100.38606,116.957 Z"
          id="path377-7-5"
        />
        <path
          style={{ fill: "#1a1a1a" }}
          d="M 37.974363,197.09104 H 161.21522 l -60.82973,-77.80222 z"
          id="path377-7-5-3"
        />
        <path
          style={{ fill: "#5555ff" }}
          d="M 179.34721,55.753403 V 178.99426 l -77.80222,-60.82973 z"
          id="path377-7-5-3-5"
        />
      </g>
    </svg>
  );
}

function _Cross({ size, bg, fg }) {
  return (
    <svg width={size} height={size} viewBox="-5 -5 10 10">
      <circle cx="0" cy="0" r="5" fill={bg} />
      <circle cx="0" cy="-1" r="2" stroke={fg} strokeWidth="0.5" fill="none" />
      <g strokeWidth="1.8">
        <path d="M -3.4,-1 L 3.4,-1" stroke={fg} />
        <path d="M 0,-4 L 0,4" stroke={fg} />
      </g>
    </svg>
  );
}

export const roles = {
  imperator: {
    name: "Imperator",
    symbol: <Lamen officer="imperator" height={25} />,
    color: "red",
  },
  praemonstrator: {
    name: "Praemonstrator",
    symbol: <Lamen officer="praemonstrator" height={25} />,
    color: "blue",
  },
  cancellarius: {
    name: "Cancellarius",
    symbol: <Lamen officer="cancellarius" height={25} />,
    color: "#ca0",
  },
  hierophant: {
    name: "Hierophant",
    symbol: <Lamen officer="hierophant" height={25} />,
    color: "red",
  },
  pastHierophant: {
    name: "Past Hierophant",
    symbol: (
      <span>
        (<Lamen officer="hierophant" height={25} />)
      </span>
    ),
    color: "red",
  },
  hiereus: {
    name: "Hiereus",
    symbol: <Lamen officer="hiereus" height={25} />,
    color: "black",
  },
  hegemon: {
    name: "Hegemon",
    symbol: <Lamen officer="hegemon" height={25} />,
    color: "#aaa",
  },
  keryx: {
    name: "Keryx",
    symbol: <Lamen officer="keryx" height={25} />,
    color: "#c55",
  },
  stolistes: {
    name: "Stolistes",
    symbol: <Lamen officer="stolistes" height={25} />,
    color: "#55c",
  },
  dadouchos: {
    name: "Dadouchos",
    symbol: <Lamen officer="dadouchos" height={25} />,
    color: "#cc5",
  },
  sentinel: {
    name: "Sentinel",
    symbol: <Lamen officer="sentinel" height={25} />,
    color: "#777",
  },
  candidate: { name: "Candidate", symbol: "🤠", color: "#fcf" },
  aspirant: { name: "Aspirant", symbol: "🤒", color: "#fcf" },
  member: { name: "Member", color: "#ccc" },
  psaltis: { name: "Psaltis", symbol: "🎵", color: "#c55" },
};

export const roleAliases = {
  hiero: "hierophant",
  pastHiero: "pastHierophant",
  phylax: "sentinel",
};

for (const [alias, role] of Object.entries(roleAliases)) {
  roles[alias] = roles[role];
}

function _HideOnScroll(props) {
  const { children, window } = props;
  // Note that you normally won't need to set the window ref as useScrollTrigger
  // will default to window.
  // This is only being set here because the demo is in an iframe.
  const trigger = useScrollTrigger({
    target: window ? window() : undefined,
  });

  return (
    <Slide appear={false} direction="down" in={!trigger} style={{}}>
      {children}
    </Slide>
  );
}

function ShowVar({ v, ctxVar }) {
  const timeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = React.useState(ctxVar.value);
  const set = React.useCallback(
    (value: string) => {
      setValue(value);
      if (timeout.current) clearTimeout(timeout.current);
      timeout.current = setTimeout(() => ctxVar.set(value), 1000);
    },
    [ctxVar],
  );

  return (
    <span key={v.name}>
      {v.varType === "select" && (
        <FormControl>
          <InputLabel id={"input-" + v.name + "-label"}>{v.label}</InputLabel>
          <Select
            labelId={"input-" + v.name + "-label"}
            label={v.label}
            value={value}
            onChange={(e) => set(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {v.children.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
      {v.varType === "text" && (
        <TextField
          label={v.label}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
      <br />
      <br />
    </span>
  );
}

function ShowVars({ vars, context }) {
  return vars
    .filter((v) => !v.hidden)
    .map((v) => <ShowVar key={v.name} v={v} ctxVar={context.vars[v.name]} />);
}

function ZoomMenu({
  anchorEl,
  setAnchorEl,
  onCloseExtra,
  fontSize,
  setFontSize,
}) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={(event) => {
        setAnchorEl(null);
        onCloseExtra(event);
      }}
      anchorOrigin={{ vertical: "center", horizontal: "left" }}
      transformOrigin={{ horizontal: "right", vertical: "center" }}
      PaperProps={{
        elevation: 0,
        sx: {
          overflow: "visible",
          filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
          mr: 1.5,
          "& .MuiAvatar-root": {
            width: 32,
            height: 32,
            ml: -0.5,
            mr: 1,
          },
          "&:before": {
            content: '""',
            display: "block",
            position: "absolute",
            bottom: 10,
            right: -5,
            width: 10,
            height: 10,
            bgcolor: "background.paper",
            transform: "translateY(-50%) rotate(45deg)",
            zIndex: 0,
          },
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0}>
        <IconButton
          aria-label="decrease font size"
          onClick={() => setFontSize(fontSize - 5)}
        >
          <RemoveIcon />
        </IconButton>
        <span>{fontSize}%</span>
        <IconButton
          aria-label="increase font size"
          onClick={() => setFontSize(fontSize + 5)}
        >
          <AddIcon />
        </IconButton>
      </Stack>
    </Popover>
  );
}

function TocMenu({ anchorEl, setAnchorEl, titles, onCloseExtra }) {
  return (
    <Menu
      anchorEl={anchorEl}
      id="toc"
      open={!!anchorEl}
      onClose={(event) => {
        setAnchorEl(null);
        onCloseExtra(event);
      }}
      anchorOrigin={{ vertical: "center", horizontal: "left" }}
      transformOrigin={{ horizontal: "right", vertical: "center" }}
      PaperProps={{
        elevation: 0,
        sx: {
          overflow: "visible",
          filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
          mb: 1.5,
          "& .MuiAvatar-root": {
            width: 32,
            height: 32,
            ml: -0.5,
            mr: 1,
          },
          "&:before": {
            content: '""',
            display: "block",
            position: "absolute",
            top: "50%",
            right: -5,
            width: 10,
            height: 10,
            bgcolor: "background.paper",
            transform: "translateY(-50%) rotate(45deg)",
            zIndex: 0,
          },
        },
      }}
    >
      {titles.map((title, i) => (
        <MenuItem
          key={i}
          onClick={() => {
            location.hash = title.replace(/ /g, "_");
            setAnchorEl(null);
            onCloseExtra();
          }}
        >
          {title}
        </MenuItem>
      ))}
    </Menu>
  );
}

const regexp =
  /Rendered (more|fewer) hooks than|change in the order of Hooks|#300|#310/;

// Based on https://stackoverflow.com/a/54549601/1839099
if (typeof window !== "undefined") {
  window.addEventListener("error", function (e) {
    if (e.message.match(regexp)) {
      // prevent React's listener from firing
      e.stopImmediatePropagation();
      // prevent the browser's console error message
      e.preventDefault();
      console.log("%c Suppresed more/fewer hooks error", "color: #ccc");
    }
  });
}

// Ok for whatever reason this stops the error but doesn't "catch" it (i.e. no logs)
class ErrorBoundary extends React.Component<{
  // biome-ignore lint/suspicious/noExplicitAny: another day
  fallback?: React.ReactElement<any>;
  // biome-ignore lint/suspicious/noExplicitAny: another day
  children: React.ReactElement<any>;
}> {
  state = { error: null as Error | null, info: null };

  constructor(props) {
    super(props);
  }

  static getDerivedStateFromError(error) {
    // console.log("error", error);

    if (error.message.match(regexp)) {
      return { error: null, info: null };
    }

    // Update state so the next render will show the fallback UI.
    return { error, info: null };
  }

  componentDidCatch(error, info) {
    // Example "componentStack":
    //   in ComponentThatThrows (created by App)
    //   in ErrorBoundary (created by App)
    //   in div (created by App)
    //   in App
    // console.error(2, error, info /*.componentStack */);
    // this.setState({ error, info });
    /*
    if (error.message.match(regexp)) {
      setTimeout(() => {
        console.log("setState");
        this.setState({ error: null, info: null });
      }, 500);
    }
    */
  }

  render() {
    // console.log(this.state);
    if (this.state.error) {
      // You can render any custom fallback UI
      return (
        this.props.fallback || (
          <div>
            {this.state.error.message}
            <br />
            {this.state.info}
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default function DocRender({
  doc,
  wrapWithErrorBoundary,
}: {
  doc: DocNode;
  wrapWithErrorBoundary?: boolean;
}) {
  // console.log({ doc });
  const router = useRouter();
  const searchParams = useSearchParams();
  //const doc = { children: [{ type: "text", value: "hi" }] };
  //const [doc, setDoc] = React.useState(origDoc);

  const titles =
    doc.children?.filter((c) => c.type === "title").map((b) => b.text) || [];

  type VarDesc = {
    type: "declareVar";
    name: string;
    default: string;
    collapsable?: boolean;
  };
  const vars = React.useMemo(
    () =>
      (doc.children?.filter((c) => c.type === "declareVar") || []) as VarDesc[],
    [doc.children],
  );

  const [sdOpen, setSdOpen] = React.useState(false);
  const [tocAnchorEl, setTocAnchorEl] = React.useState<
    (EventTarget & HTMLDivElement) | null
  >(null);
  const [zoomAnchorEl, setZoomAnchorEl] = React.useState<
    (EventTarget & HTMLDivElement) | null
  >(null);

  const [fontSize, setFontSize] = React.useState(100);

  const context = { vars: {}, roles };
  for (const varDesc of vars) {
    // const [value, set] = React.useState(varDesc.default);
    const value = searchParams?.get(varDesc.name) ?? varDesc.default;
    const set = (value) => {
      const newParams = new URLSearchParams(searchParams || {});
      newParams.set(varDesc.name, value);
      const url =
        location.href.substring(0, -location.search.length) +
        "?" +
        newParams.toString();

      router.replace(url, {
        scroll: false,
        // shallow: true,
      });
    };
    context.vars[varDesc.name] = { value, set };
  }
  // console.log("context", context);

  const [alwaysVars, collapsableVars] = React.useMemo(() => {
    // console.log(vars);
    const alwaysVars: VarDesc[] = [],
      collapsableVars: VarDesc[] = [];
    for (const variable of vars)
      if (variable.collapsable) collapsableVars.push(variable);
      else alwaysVars.push(variable);
    return [alwaysVars, collapsableVars];
  }, [vars]);

  const [nextPos, setNextPos] = React.useState(0);
  const [currentPos, setCurrentPos] = React.useState(0);
  const jumped = React.useRef<number | false>(false);

  React.useEffect(() => {
    function scrollListener(event) {
      let nextPosSet = false;
      let currentPosSet = false;
      const bottom = window.pageYOffset + window.innerHeight;

      // TODO, re-implement with binary search.
      // const start = Date.now();
      if (doc.children)
        for (let i = 0; i < doc.children.length; i++) {
          const node = doc.children[i];
          if (node.type !== "task") continue;
          if (
            node.forMe &&
            !nextPosSet &&
            node?.ref?.current &&
            node.ref.current.offsetTop > bottom
          ) {
            nextPosSet = true;
            setNextPos(i);
          } else {
            if (
              !currentPosSet &&
              node?.ref?.current &&
              node.ref.current.offsetTop > bottom
            ) {
              currentPosSet = true;
              setCurrentPos(i - 1);
            }
          }
          if (nextPosSet && currentPosSet) break;
        }
      // console.log("diff " + (Date.now() - start) + "ms");
      // console.log(window.pageYOffset);
    }
    window.addEventListener("scroll", scrollListener);
    return () => window.removeEventListener("scroll", scrollListener);
  }, [doc.children]);

  // console.log({ currentPos, nextPos });

  return (
    <>
      <Box sx={{ background: "#efeae2", p: 2, fontSize: fontSize + "%" }}>
        <div>
          <ShowVars vars={alwaysVars} context={context} />
          <details>
            <summary>More Variables</summary>
            <br />
            <ShowVars vars={collapsableVars} context={context} />
          </details>
        </div>

        <br />

        <div
          className="docBody"
          style={
            {
              // fontFamily: "Frank Ruehl CLM, Roboto, Helvetica, Arial, sans-serif",
            }
          }
        >
          <DocContext.Provider value={context}>
            {wrapWithErrorBoundary ? (
              <ErrorBoundary>
                <Render doc={doc} />
              </ErrorBoundary>
            ) : (
              <Render doc={doc} />
            )}
          </DocContext.Provider>
        </div>
      </Box>

      <SpeedDial
        ariaLabel="SpeedDial basic example"
        sx={{ position: "fixed", bottom: 16, right: 16 }}
        icon={nextPos - currentPos}
        open={sdOpen}
        onOpen={(event, reason) => {
          // "mouseEnter", "focus"
          if (["toggle"].includes(reason)) setSdOpen(true);
        }}
        onClose={(event, reason) => {
          // "blur", "mouseLeave"
          if (["toggle", "escapeKeyDown"].includes(reason)) setSdOpen(false);
        }}
      >
        {jumped.current ? (
          <SpeedDialAction
            icon=<ArrowUpwardIcon />
            tooltipTitle="Jump Back"
            onClick={() => {
              if (jumped.current) window.scrollTo(0, jumped.current);
              jumped.current = false;
            }}
          />
        ) : (
          <SpeedDialAction
            icon=<ArrowDownwardIcon />
            tooltipTitle="Jump to Next"
            onClick={() => {
              jumped.current = window.pageYOffset;
              doc.children?.[nextPos]?.ref?.current?.scrollIntoView(false);
            }}
          />
        )}
        <SpeedDialAction
          icon=<ListIcon />
          tooltipTitle="Table of Contents"
          onClick={(event) => {
            tocAnchorEl
              ? setTocAnchorEl(null)
              : setTocAnchorEl(event.currentTarget);
          }}
        />
        <SpeedDialAction
          icon=<ZoomInIcon />
          tooltipTitle="Zoom In/Out"
          onClick={(event) => setZoomAnchorEl(event.currentTarget)}
        />
        ))
      </SpeedDial>

      <ZoomMenu
        anchorEl={zoomAnchorEl}
        setAnchorEl={setZoomAnchorEl}
        onCloseExtra={() => setSdOpen(false)}
        fontSize={fontSize}
        setFontSize={setFontSize}
      />
      <TocMenu
        anchorEl={tocAnchorEl}
        setAnchorEl={setTocAnchorEl}
        onCloseExtra={() => setSdOpen(false)}
        titles={titles}
      />
    </>
  );
}
