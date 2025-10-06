export async function sha256bytes(bytes: Uint8Array) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", Buffer.from(bytes));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

export default async function SHA256(input: Uint8Array | string) {
  let bytes: Uint8Array;

  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (typeof input === "object") {
    bytes = input;
  } else {
    throw new Error("Invalid input type");
  }

  return await sha256bytes(bytes);
}
