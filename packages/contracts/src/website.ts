import { z } from "zod";

export const websiteIntakeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(40).default("website-contact"),
});

export type WebsiteIntake = z.infer<typeof websiteIntakeSchema>;

export interface WebsiteIntakeResponse {
  id: string;
}
