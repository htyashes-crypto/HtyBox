import { Search } from "@icon-park/react";

export default function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        size={14}
        fill="#a8a29a"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#e5e2d9] bg-white py-1.5 pr-2 pl-8 text-xs text-[#191919] outline-none transition-colors placeholder:text-[#a8a29a] focus:border-[#d97757]"
      />
    </div>
  );
}
