import type { Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import remarkGfm from "remark-gfm";

export const chatMarkdownRemarkPlugins = [remarkGfm];

/**
 * Assistant answers render as GFM. Links open in a new tab without a referrer or
 * opener. react-markdown's default URL transform empties unsafe protocols
 * before `href` reaches these components; such links render as inert
 * placeholders and fragment links stay in this tab.
 */
export const chatMarkdownComponents: Components = {
  a: ({ node, href, ...props }) =>
    href && !href.startsWith("#") ? (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer" />
    ) : (
      <a {...props} {...(href ? { href } : {})} />
    ),
  table: ({ node, ...props }) => <table {...props} className="rehype-table" />,
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
};
