export const CANON = { 234: [-1, 0], 454: [1, 0], 10: [0, -0.98], 152: [0, 1.39] };
export const OVAL_IDX = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export function fitAffine(pairs) { // pairs: [[cx,cy,sx,sy,w]]
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const [x, y, X, Y, w] of pairs) { const v = [x, y, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) A[i][j] += w * v[i] * v[j]; bx[i] += w * v[i] * X; by[i] += w * v[i] * Y; } }
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-9) return null;
  const solve = (b) => [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
  const [a, c, e] = solve(bx), [b, d, f] = solve(by);
  return { a, b, c, d, e, f };
}
export function invAffine(M) { const det = M.a * M.d - M.b * M.c; return { a: M.d / det, b: -M.b / det, c: -M.c / det, d: M.a / det, e: (M.c * M.f - M.d * M.e) / det, f: (M.b * M.e - M.a * M.f) / det }; }
