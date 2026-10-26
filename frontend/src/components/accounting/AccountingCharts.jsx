import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { money } from "./categoryIcons";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const label = (k) => (k.length === 7 ? MONTHS[Number(k.slice(5, 7)) - 1] : `${Number(k.slice(8, 10))}/${Number(k.slice(5, 7))}`);

export const IncomeExpenseChart = ({ series }) => (
  <div className="h-64" data-testid="accounting-bar-chart">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series.map((s) => ({ ...s, name: label(s.key) }))} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `$${v}`} />
        <Tooltip formatter={(v) => money(v)} cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="income" name="Ganancias" fill="#10b981" radius={[6, 6, 0, 0]} />
        <Bar dataKey="expenses" name="Gastos" fill="#f43f5e" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export const CategoryDonut = ({ data, total }) => (
  <div className="relative h-56" data-testid="accounting-donut-chart">
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="amount" nameKey="label" innerRadius="62%" outerRadius="90%" paddingAngle={2} stroke="none">
          {data.map((d) => <Cell key={d.key} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }} />
      </PieChart>
    </ResponsiveContainer>
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span className="text-[11px] text-slate-400">Gastos</span>
      <span className="text-lg font-bold text-slate-800">{money(total)}</span>
    </div>
  </div>
);
