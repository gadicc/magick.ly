import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useSetSearchParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (key: string, val: string | string[]) => {
    const params = new URLSearchParams(searchParams || undefined);
    if (Array.isArray(val)) val.forEach((v) => params.append(key, v));
    else params.set(key, val);
    router.push(pathname + "?" + params.toString());
  };
}

export { useRouter, usePathname, useSearchParams };
