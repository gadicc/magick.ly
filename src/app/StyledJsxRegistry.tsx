"use client";

import { useServerInsertedHTML } from "next/navigation";
import React from "react";
import { createStyleRegistry, StyleRegistry } from "styled-jsx";

/**
 * Collects `<style jsx>` rules during server rendering and writes them into
 * the HTML, so prerendered components are styled before hydration.
 */
export default function StyledJsxRegistry({
  children,
}: {
  children: React.ReactNode;
}) {
  const [registry] = React.useState(() => createStyleRegistry());
  useServerInsertedHTML(() => {
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });
  return <StyleRegistry registry={registry}>{children}</StyleRegistry>;
}
