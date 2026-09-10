import profile from "./active.json";
import type { TaskProfile } from "../plugin/contracts/task-profile";
export const ACTIVE_PROFILE = profile as unknown as TaskProfile;
