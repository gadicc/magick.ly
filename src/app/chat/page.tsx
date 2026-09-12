"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Image from "next/image";
import React from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { ToastContainer, toast } from "react-toastify";
import rehypeAddClasses from "rehype-add-classes";
import remarkGfm from "remark-gfm";
import { createUuidV7 } from "@/lib/ids";
import "react-toastify/dist/ReactToastify.css";
import {
  Autorenew,
  DeleteForever,
  Send,
  StopCircle,
} from "@mui/icons-material";
import {
  Avatar,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
} from "@mui/material";
import AndroidMagicianAvatar from "@/app/img/android-magician-avatar.png";
import { UserAvatar } from "../MyAppBar";
import {
  type ChatMessage,
  type ChatSource,
  messageSources,
  messageText,
} from "./contracts";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeAddClasses, { table: "rehype-table" }]];

function Source({
  source,
  cheatModeEnabled,
}: {
  source: ChatSource;
  cheatModeEnabled: boolean;
}) {
  const meta = source.metadata;
  const { title, author, pageNumber, identifier } = (() => {
    if (meta["pdf.info.Title"]) {
      return {
        title: meta["pdf.info.Title"] as string,
        author: meta["pdf.info.Author"] as string,
        pageNumber: meta["loc.pageNumber"] as number,
        identifier: meta["pdf.metadata._metadata.xmp:identifier"] as string,
      };
    } else if (meta.pdf) {
      return {
        title: meta.pdf.info?.Title ?? "Unknown",
        author: meta.pdf.info?.Author ?? "Unknown",
        pageNumber: meta.loc?.pageNumber,
        identifier: "TODO",
      };
    } else {
      return {
        title: "Unknown",
        author: "Unknown",
        pageNumber: 0,
        identifier: "",
      };
    }
  })();

  const amazon =
    typeof identifier === "string" && identifier.match(/asin(\w{10,10})/)?.[1];

  // console.log(identifier, amazon);

  const attribution = (
    <>
      <i>{title}</i>, {author}, page {pageNumber}
      {amazon && (
        <>
          ; available from{" "}
          <a
            href={`https://www.amazon.com/dp/${amazon}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ opacity: 0.3 }}
          >
            Amazon
          </a>
        </>
      )}
      .
    </>
  );

  return (
    <li>
      {cheatModeEnabled ? (
        <details>
          <summary>{attribution}</summary>
          <p style={{ fontSize: "75%" }}>{source.pageContent}</p>
        </details>
      ) : (
        attribution
      )}
    </li>
  );
}

function Sources({
  sources,
  cheatModeEnabled,
}: {
  sources: ChatSource[];
  cheatModeEnabled: boolean;
}) {
  return (
    <details>
      <summary>Sources</summary>
      <div style={{ fontSize: "80%", marginTop: 4 }}>
        The following sources may (or may not) have been used to generate this
        response and may (or may not) provide additional details.
      </div>
      <ol>
        {sources.map((source, i) => (
          <Source key={i} source={source} cheatModeEnabled={cheatModeEnabled} />
        ))}
      </ol>
    </details>
  );
}

export default function Chat() {
  const ref = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [cheatModeEnabled, setCheatModeEnabled] = React.useState(false);
  const cheatModeCount = React.useRef(0);
  const cheatModeLast = React.useRef(0);
  const [input, setInput] = React.useState("");
  const [chatId, setChatId] = React.useState(createUuidV7);
  const transport = React.useMemo(
    () => new DefaultChatTransport<ChatMessage>({ api: "/chat/api/v2" }),
    [],
  );
  const {
    messages: _messages,
    sendMessage,
    status,
    regenerate,
    stop,
  } = useChat<ChatMessage>({
    id: chatId,
    transport,
    generateId: createUuidV7,
    onError: (error) => toast(error.message),
  });
  const isLoading = status === "submitted" || status === "streaming";
  const autoscroll = React.useRef(true);

  const messages =
    _messages.length > 0
      ? _messages
      : ([
          {
            id: "START",
            parts: [
              {
                type: "text",
                text:
                  "Hi, I'm your friendly Magician's Assistant.  Ask me anything " +
                  "about Magick, but please remember that I'm not perfect and " +
                  "can make mistakes.",
              },
            ],
            role: "assistant",
          },
        ] satisfies ChatMessage[]);

  React.useEffect(() => {
    if (_messages.length && autoscroll.current) {
      window.scrollTo(0, document.body.scrollHeight);
    }
  }, [_messages]);

  React.useEffect(() => {
    function checkScroll() {
      const el = document.documentElement;
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 1;
      if (atBottom) autoscroll.current = true;
      else autoscroll.current = false;
    }
    document.addEventListener("scrollend", checkScroll);
    return () => document.removeEventListener("scrollend", checkScroll);
  }, []);

  const CheatModeCounter = React.useCallback(() => {
    const now = Date.now();
    const last = cheatModeLast.current;
    cheatModeLast.current = now;

    if (now - last > 1_000) {
      cheatModeCount.current = 0;
    }

    // console.log(cheatModeCount.current);

    // Starts from 0, so 4 means 5 clicks
    if (cheatModeCount.current < 4) {
      cheatModeCount.current++;
      return;
    }

    if (cheatModeEnabled) {
      toast("Cheat Mode disabled");
    } else {
      toast("Cheat Mode enabled");
    }
    setCheatModeEnabled(!cheatModeEnabled);
    cheatModeCount.current = 0;
  }, [cheatModeEnabled]);

  return (
    <>
      <div id="messages">
        {messages.map((m) => {
          const sources = messageSources(m);
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                padding: "2px 15px 2px 15px",
                backgroundColor: m.role === "assistant" ? "#f7f7f7" : "",
                borderTop: m.role === "assistant" ? "1px solid #ccc" : "",
                borderBottom: m.role === "assistant" ? "1px solid #ccc" : "",
                overflowX: "auto",
              }}
            >
              <div style={{ width: "50px", marginTop: "19px" }}>
                {m.role === "user" ? (
                  <UserAvatar
                    sx={{ width: 32, height: 32, border: "1px solid #888" }}
                  />
                ) : (
                  <Avatar
                    sx={{ width: 32, height: 32, border: "1px solid #888" }}
                    onClick={CheatModeCounter}
                  >
                    <Image
                      src={AndroidMagicianAvatar}
                      width={32}
                      height={32}
                      alt="Assistant"
                    />
                  </Avatar>
                )}
              </div>
              <style>{`
          .ai_content table {
            margin-top: 1em;
            margin-bottom: 1em;
            border-spacing: 0;
            border-collapse: collapse;
          }
          .ai_content table tr {
            background-color: #fff;
            border-top: 1px solid #c6cbd1;
          }
          .ai_content table tbody tr:nth-child(odd) {
            background-color: #f6f8fa;
          }
          .ai_content table th,
          .ai_content table td {
            padding: 6px 13px;
            border: 1px solid #dfe2e5;
          }
          .ai_content table th {
            font-weight: 600;
          }
          .ai_content li {
            font-size: 90%;
          }
          .ai_content li + li {
            margin-top: 1em;
          }
        `}</style>
              <div
                className="ai_content"
                style={{ width: "50px", flexGrow: 1 }}
              >
                <ReactMarkdown
                  linkTarget="_blank"
                  remarkPlugins={remarkPlugins}
                  // @ts-expect-error: its fine
                  rehypePlugins={rehypePlugins}
                  components={{
                    code({ node, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || "");
                      return match ? (
                        <SyntaxHighlighter
                          {...props}
                          style={dark}
                          language={match[1]}
                          PreTag="div"
                        >
                          {String(children).replace(/\n$/, "")}
                        </SyntaxHighlighter>
                      ) : (
                        <code {...props} className={className}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {messageText(m)}
                </ReactMarkdown>
                {sources ? (
                  <Sources
                    sources={sources}
                    cheatModeEnabled={cheatModeEnabled}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ height: "130px" }}>&nbsp;</div>
      <div ref={ref}></div>
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          padding: "15px 10px 10px 10px",
          width: "100%",
          backgroundImage:
            "linear-gradient(rgba(255, 255, 255, 0) 0%, rgb(255, 255, 255) 12px)",
        }}
      >
        {_messages.length > 0 && !isLoading && (
          <div
            style={{
              bottom: 66,
              left: 0,
              position: "fixed",
              padding: "10px",
              textAlign: "center",
              width: "100%",
            }}
          >
            <Chip
              icon={<Autorenew fontSize="small" />}
              label="Regenerate Response"
              onClick={() => void regenerate()}
              sx={{
                "&:hover": {
                  background: "#dadada",
                },
                border: "1px solid #dfdfdf",
                background: "#f0f0f0",
                boxShadow: "0 0 5px white",
              }}
            />
          </div>
        )}
        {isLoading && (
          <div
            style={{
              bottom: 80,
              position: "absolute",
              padding: "10px",
              textAlign: "center",
              width: "100%",
            }}
          >
            <Chip
              icon={<StopCircle fontSize="small" />}
              label="Stop Generating"
              onClick={() => void stop()}
              sx={{
                "&:hover": {
                  background: "#dadada",
                },
                border: "1px solid #dfdfdf",
                background: "#f0f0f0",
                boxShadow: "0 0 5px white",
              }}
            />
          </div>
        )}{" "}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading || !input.trim()) return;
            autoscroll.current = true;
            void sendMessage({ text: input });
            setInput("");
          }}
        >
          <TextField
            fullWidth
            placeholder="Send a message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <IconButton
                    onClick={() => {
                      void stop();
                      // A new hook instance cannot receive late chunks from
                      // the conversation that was just cancelled.
                      setChatId(createUuidV7());
                      setInput("");
                    }}
                    edge="start"
                    title="New Chat"
                  >
                    <DeleteForever />
                  </IconButton>
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    title="Send Message"
                    onClick={(e) => buttonRef.current?.click()}
                    edge="end"
                    disabled={isLoading || !input.trim()}
                  >
                    {isLoading ? <CircularProgress size="20px" /> : <Send />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <button ref={buttonRef} style={{ display: "none" }} type="submit">
            Send
          </button>
        </form>
        {/*
    <div style={{ fontSize: "50%", marginTop: "5px" }}>
      Do not rely on these answers, this is a PRIVATE EXPERIMENT (you should
      know Gadi or Aaron).
    </div>
    */}
      </div>
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={false}
        pauseOnHover
      />
    </>
  );
}
