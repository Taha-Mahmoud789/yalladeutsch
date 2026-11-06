"use client";

import { useEffect } from "react";

export default function PracticeBootstrap() {
  useEffect(() => {
    import("../views/initialize").catch((error) => {
      console.error("Could not initialize YallaDeutsch", error);
    });
  }, []);
  return null;
}
