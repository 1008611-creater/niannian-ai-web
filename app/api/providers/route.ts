import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
