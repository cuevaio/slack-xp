export type AuthenticatedNewHire = {
  id: string;
  sessionId: string;
  fullName: string;
  imageUrl: string | null;
  isOperator: boolean;
  authentication: "clerk" | "mock";
};
