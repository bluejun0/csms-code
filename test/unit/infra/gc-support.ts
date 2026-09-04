// 한 번으로는 회수되지 않는 세대가 있어, 안정적인 측정을 위해 네 번 강제한다.
export const forceGc = (): void => {
  for (let i = 0; i < 4; i++) (global as { gc?: () => void }).gc?.();
};
