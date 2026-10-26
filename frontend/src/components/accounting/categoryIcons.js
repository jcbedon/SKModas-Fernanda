import { Users, Truck, Megaphone, Package, Zap, Home, Car, Tag, ShoppingBag, Coffee, Wrench, Smartphone } from "lucide-react";

export const CATEGORY_ICONS = { users: Users, truck: Truck, megaphone: Megaphone, package: Package, zap: Zap, home: Home, car: Car, tag: Tag, bag: ShoppingBag, coffee: Coffee, wrench: Wrench, phone: Smartphone };
export const CATEGORY_COLORS = ["#6366f1", "#0ea5e9", "#ec4899", "#f59e0b", "#14b8a6", "#8b5cf6", "#f97316", "#64748b", "#ef4444", "#22c55e"];
export const iconFor = (key) => CATEGORY_ICONS[key] || Tag;
export const money = (v) => "$" + Number(v || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
