export type AuthenticatedNewHire = {
  id: string;
  sessionId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  imageUrl: string | null;
  sourceVersion: number;
  isOperator: boolean;
  authentication: "clerk" | "mock";
};
