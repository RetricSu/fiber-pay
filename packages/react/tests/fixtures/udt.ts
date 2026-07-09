export const validUdtScript = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type' as const,
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
};

export const validUdtAsset = {
  kind: 'udt' as const,
  script: validUdtScript,
  name: 'RUSD',
};
