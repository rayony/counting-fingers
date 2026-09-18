import { createFileRoute } from "@tanstack/react-router";
import { CameraApp } from "@/components/camera-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CameraApp />;
}
