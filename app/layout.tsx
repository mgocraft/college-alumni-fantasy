
import "./../styles/globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "College Alumni Fantasy", description: "Weekly fantasy points by college alumni." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body><div className="container">{children}</div></body></html>);
}
