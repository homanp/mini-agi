import { promises as fs } from "node:fs";
import path from "node:path";

export interface UserProfile {
  userId: string;
  name: string;
  taskPreferences: string;
  updatedAt: string;
}

export async function loadUserProfile(
  dir: string,
  userId: string
): Promise<UserProfile | null> {
  const filePath = path.join(dir, `profile-${userId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function saveUserProfile(
  dir: string,
  profile: UserProfile
): Promise<void> {
  const filePath = path.join(dir, `profile-${profile.userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf-8");
}
