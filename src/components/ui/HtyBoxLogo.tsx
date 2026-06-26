import { useEffect, useRef, useState } from "react";

/** HtyBox 纸箱 logo —— 等距盒子 + 梯形盖「绕铰链旋转→等距投影」的真 3D 开合动画。
 *  几何/角度由 Step 1 spike 标定:等距投影基 + 盖深 DEPTH + 打开角 OPEN_DEG。 */

// 等距投影:screen = C + x·EX + y·EY + z·EZ  (x 沿 T→R, y 沿 T→L, z 高度向下)
const CX = 256, CY = 184;
const EX = [142, 80], EY = [-142, 80], EZ = [0, 168];
const proj = (x: number, y: number, z: number): [number, number] => [
  CX + x * EX[0] + y * EY[0] + z * EZ[0],
  CY + x * EX[1] + y * EY[1] + z * EZ[1],
];
const fp = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

// 顶面四角(z=0) + 底面三角(z=1)——固定不动
const T = proj(-0.5, -0.5, 0), R = proj(0.5, -0.5, 0), F = proj(0.5, 0.5, 0), L = proj(-0.5, 0.5, 0);
const Fb = proj(0.5, 0.5, 1), Rb = proj(0.5, -0.5, 1), Lb = proj(-0.5, 0.5, 1);

const DEPTH = 0.4036; // 盖深(由还原现有打开态外角反求)
const OPEN_DEG = 226; // 打开态翻折角(还原现有 Arts)
const SW = 16;        // viewBox 512 下统一描边宽

// 左盖梯形:铰链 L-F,盖深绕 x 轴翻折 θ;右盖梯形:铰链 F-R,盖深绕 y 轴翻折 θ
const leftFlap = (deg: number) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), d = DEPTH;
  return [L, F, proj(0.5, 0.5 - d * c, -d * s), proj(-0.5, 0.5 - d * c, -d * s)].map(fp).join(" ");
};
const rightFlap = (deg: number) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), d = DEPTH;
  return [F, R, proj(0.5 - d * c, -0.5, -d * s), proj(0.5 - d * c, 0.5, -d * s)].map(fp).join(" ");
};

const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const face = { stroke: "#2A211C", strokeWidth: SW, strokeLinejoin: "round" as const };
const edge = { stroke: "#2A211C", strokeWidth: SW, strokeLinecap: "round" as const };

export default function HtyBoxLogo({
  size = 32,
  openOnHover = false,
  introOnMount = false,
  initial = "closed",
  className,
}: {
  size?: number;
  openOnHover?: boolean;
  introOnMount?: boolean;
  initial?: "open" | "closed";
  className?: string;
}) {
  const restDeg = introOnMount ? 0 : initial === "open" ? OPEN_DEG : 0; // 静止停留角度
  const [deg, setDeg] = useState(introOnMount ? OPEN_DEG : restDeg);
  const degRef = useRef(deg);
  const rafRef = useRef(0);

  const animateTo = (target: number, dur = 460) => {
    cancelAnimationFrame(rafRef.current);
    const from = degRef.current;
    if (from === target) return;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / dur);
      const cur = from + (target - from) * easeInOutCubic(p);
      degRef.current = cur;
      setDeg(cur);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // 入场:从打开动画到闭合(open→close 点题),并在卸载时清理 rAF
  useEffect(() => {
    if (introOnMount) animateTo(0);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // hover 时翻到与静止端相反的一端,移开回静止端(默认开→hover关,或默认关→hover开)
  const hover = openOnHover
    ? { onMouseEnter: () => animateTo(restDeg === 0 ? OPEN_DEG : 0), onMouseLeave: () => animateTo(restDeg) }
    : {};

  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={["hty-logo", className].filter(Boolean).join(" ")} {...hover}>
      {/* 顶部开口内壁 + 中缝(F-T) */}
      <polygon points={`${fp(T)} ${fp(R)} ${fp(F)} ${fp(L)}`} fill="#C75E38" {...face} />
      <line x1={F[0]} y1={F[1]} x2={T[0]} y2={T[1]} {...edge} />
      {/* 外侧两面 + 中棱(F-Fb) */}
      <polygon points={`${fp(L)} ${fp(F)} ${fp(Fb)} ${fp(Lb)}`} fill="#E57B53" {...face} />
      <polygon points={`${fp(F)} ${fp(R)} ${fp(Rb)} ${fp(Fb)}`} fill="#D26741" {...face} />
      <line x1={F[0]} y1={F[1]} x2={Fb[0]} y2={Fb[1]} {...edge} />
      {/* 两片梯形盖(随 deg 翻折) */}
      <polygon points={leftFlap(deg)} fill="#F8EEE1" {...face} />
      <polygon points={rightFlap(deg)} fill="#F2E6D6" {...face} />
      {/* hty 贴右前斜面(固定) */}
      <g transform="translate(330,362) skewY(-29.4)" fontFamily="'Arial Black','Segoe UI','Microsoft YaHei',sans-serif" fontWeight="900" fontSize="46" textAnchor="middle" letterSpacing="1">
        <text transform="translate(2.4,2.8)" fill="#4f2712">hty</text>
        <text transform="translate(1.2,1.4)" fill="#653419">hty</text>
        <text fill="#F7EDE0" stroke="#2A211C" strokeWidth="4" paintOrder="stroke">hty</text>
      </g>
    </svg>
  );
}
