import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive, ArchiveRestore, Banknote, CreditCard, History, MonitorSmartphone, Pencil, Play, Plus, Settings2, ShoppingCart,
  Trash2, UserRound, Users, Warehouse,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { posPermissionLevel } from "@/lib/authSession";
import {
  DEVICE_TYPES, deletePosDevice, deviceTypeLabel, listPosDevices, loadPosContext, loadPosSettings, openPosSession, posErrorText, trackMySession,
  savePosDevice, setPosDeviceActive,
  type DeviceType, type PosContext, type PosDevice, type PosSettingsPayload,
} from "@/lib/pos";
import {
  Code, ErrorNote, PosButton, PosCard, PosConfirm, PosHeader, PosModal, num, posInput, posLabel, posSelect, useMoney, usePosDate,
} from "@/components/pos/PosUi";

type DeviceForm = {
  name: string; deviceType: DeviceType; warehouseId: string; cardAccount: string; branchIds: string[]; userIds: string[]; notes: string;
};

/**
 * نقاط البيع: الأجهزة (صندوق أو عهدة) وحالتها، وفتح جلسة ومتابعتها، وإدارة الأجهزة لمن يملكها.
 * الجهاز «صندوق» له حساب نقدية خاص تحت «صناديق نقاط البيع»، و«عهدة» يقيّد النقد على حساب عهدة الموظف.
 */
export default function PosDevices() {
  const { t, direction } = useI18n();
  const money = useMoney();
  const fmtDate = usePosDate();
  const navigate = useNavigate();
  const { permissions, ready } = useRolePermissions();
  const devicesLevel = posPermissionLevel(permissions, ["pos.devices"]);
  const sessionsLevel = posPermissionLevel(permissions, ["pos.sessions"]);
  const canSell = posPermissionLevel(permissions, ["pos.sell"]) !== "none";
  const canManageDevices = devicesLevel === "manage";

  const [devices, setDevices] = useState<PosDevice[] | null>(null);
  const [ctx, setCtx] = useState<PosContext | null>(null);
  const [setup, setSetup] = useState<PosSettingsPayload | null>(null);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PosDevice | "new" | null>(null);
  const [opening, setOpening] = useState<PosDevice | null>(null);
  const [confirm, setConfirm] = useState<{ device: PosDevice; action: "archive" | "restore" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, context, settings] = await Promise.all([
      listPosDevices(),
      canSell ? loadPosContext() : Promise.resolve({ data: null, error: null }),
      devicesLevel !== "none" ? loadPosSettings() : Promise.resolve({ data: null, error: null }),
    ]);
    if (list.error) { setError(posErrorText(list.error, t)); setDevices([]); return; }
    setError("");
    setDevices(list.data ?? []);
    setCtx(context.data ?? null);
    // جلسة المستخدم أُغلقت من مكان آخر: تُمحى طلباتها المعلّقة في هذا المتصفح
    if (context.data) trackMySession(context.data.session?.id ?? null);
    setSetup(settings.data ?? null);
  }, [canSell, devicesLevel, t]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const mySession = ctx?.session ?? null;
  const visible = useMemo(() => (devices ?? []).filter((d) => showArchived || d.active), [devices, showArchived]);
  const archivedCount = (devices ?? []).filter((d) => !d.active).length;
  const userName = (id: string) => setup?.users.find((u) => u.user_id === id)?.name ?? id.slice(0, 8);

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    const { device, action } = confirm;
    const result = action === "delete" ? await deletePosDevice(device.id) : await setPosDeviceActive(device.id, action === "restore");
    setBusy(false);
    if (result.error) { toast({ title: t("تعذرت العملية"), description: posErrorText(result.error, t), variant: "destructive" }); return; }
    toast({ title: t(action === "delete" ? "حُذف الجهاز" : action === "archive" ? "أُرشف الجهاز" : "أُعيد تفعيل الجهاز"), description: device.name });
    setConfirm(null);
    await load();
  };

  if (!devices) {
    return (
      <Layout>
        <main dir={direction} className="space-y-4">
          <ErrorNote message={error} />
          {!error && <div className="rounded-xl border bg-white p-10 text-center text-slate-500">{t("جاري التحميل...")}</div>}
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main dir={direction} className="space-y-5">
        <PosHeader
          icon={MonitorSmartphone}
          title="نقاط البيع"
          description="أجهزة البيع وجلساتها. كل بيع فاتورة مبيعات، وكل حركة نقد بقيدها في المحاسبة."
          actions={
            <>
              {sessionsLevel !== "none" || canSell ? (
                <Link to="/pos/sessions"><PosButton variant="outline"><History className="h-4 w-4" />{t("الجلسات")}</PosButton></Link>
              ) : null}
              {devicesLevel !== "none" && (
                <Link to="/pos/settings"><PosButton variant="outline"><Settings2 className="h-4 w-4" />{t("الإعدادات")}</PosButton></Link>
              )}
              {canManageDevices && <PosButton onClick={() => setEditing("new")}><Plus className="h-4 w-4" />{t("جهاز جديد")}</PosButton>}
            </>
          }
        />
        <ErrorNote message={error} />

        {mySession && (
          <section className="flex flex-wrap items-center gap-4 rounded-xl border border-[#bfe0db] bg-[#e6f2f0] p-5">
            <div className="rounded-xl bg-[#0f6b63] p-3 text-white"><ShoppingCart className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#0b5751]">{t("لك جلسة مفتوحة")}</div>
              <div className="text-lg font-bold text-slate-900">
                {mySession.device_name} — <Code>{mySession.session_number}</Code>
              </div>
              <div className="text-xs text-slate-600">
                {t("منذ")} {fmtDate(mySession.opened_at)} — {t("النقد المتوقع")} <b className={num}>{money(mySession.expected_cash ?? 0)}</b>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to={`/pos/sessions/${mySession.id}`}><PosButton variant="outline">{t("تقرير الجلسة")}</PosButton></Link>
              <PosButton onClick={() => navigate("/pos/sell")}><Play className="h-4 w-4" />{t("متابعة البيع")}</PosButton>
            </div>
          </section>
        )}

        {visible.length === 0 ? (
          <PosCard>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <MonitorSmartphone className="h-10 w-10 text-slate-300" />
              <p className="max-w-md text-sm leading-7 text-slate-600">
                {t(canManageDevices
                  ? "أضف جهازًا: «صندوق» لنقطة بيع ثابتة بصندوق نقدي، أو «عهدة» لمندوب يحمل النقد معه."
                  : "لا أجهزة متاحة لك. يضيفها ويخصصها من له صلاحية إدارة الأجهزة.")}
              </p>
              {canManageDevices && <PosButton onClick={() => setEditing("new")}><Plus className="h-4 w-4" />{t("جهاز جديد")}</PosButton>}
            </div>
          </PosCard>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((d) => {
              const open = d.open_session;
              const mineHere = open?.mine;
              return (
                <article key={d.id} className={cn("flex flex-col rounded-xl border bg-white shadow-sm", !d.active && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-base font-bold text-slate-900">{d.name}</h2>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold",
                          d.device_type === "cash_box" ? "bg-[#e6f2f0] text-[#0b5751]" : "bg-indigo-50 text-indigo-700")}>
                          {t(deviceTypeLabel(d.device_type))}
                        </span>
                        {!d.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{t("مؤرشف")}</span>}
                      </div>
                      {d.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{d.notes}</p>}
                    </div>
                    {canManageDevices && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" onClick={() => setEditing(d)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={t("تعديل")} title={t("تعديل")}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => setConfirm({ device: d, action: d.active ? "archive" : "restore" })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={t(d.active ? "أرشفة" : "إعادة تفعيل")} title={t(d.active ? "أرشفة" : "إعادة تفعيل")}>
                          {d.active ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                        </button>
                        {d.sessions_count === 0 && (
                          <button type="button" onClick={() => setConfirm({ device: d, action: "delete" })} className="rounded p-1.5 text-red-600 hover:bg-red-50" aria-label={t("حذف")} title={t("حذف")}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <dl className="grid flex-1 grid-cols-1 gap-2 px-5 py-4 text-sm">
                    <div className="flex items-center gap-2 text-slate-600"><Warehouse className="h-4 w-4 text-slate-400" />{d.warehouse_name ?? "—"}</div>
                    {d.device_type === "cash_box" ? (
                      <div className="flex items-center gap-2 text-slate-600">
                        <Banknote className="h-4 w-4 text-slate-400" />
                        <span className={num}>{d.cash_account_code}</span> {d.cash_account_name}
                        {d.cash_balance !== null && <b className={cn("ms-auto text-slate-900", num)}>{money(d.cash_balance)}</b>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-600"><UserRound className="h-4 w-4 text-slate-400" />{t("النقد على حساب عهدة كل موظف")}</div>
                    )}
                    <div className="flex items-center gap-2 text-slate-600">
                      <CreditCard className="h-4 w-4 text-slate-400" />
                      {d.card_account_code ? <><span className={num}>{d.card_account_code}</span> {d.card_account_name}</> : t("البيع بالبطاقة غير متاح")}
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <Users className="h-4 w-4 text-slate-400" />
                      {d.user_ids.length === 0 ? t("كل مستخدمي نقاط البيع") : d.user_ids.map(userName).join("، ")}
                    </div>
                  </dl>
                  <div className="flex items-center justify-between gap-2 rounded-b-xl border-t bg-slate-50 px-5 py-3">
                    <div className="min-w-0 text-xs">
                      {open ? (
                        <span className="font-semibold text-amber-800">
                          {t("جلسة مفتوحة")}: {open.user_name ?? "—"} (<Code>{open.session_number}</Code>)
                        </span>
                      ) : d.device_type === "custody" && d.open_sessions_count > 0 ? (
                        <span className="text-slate-600">{t("جلسات مفتوحة")}: <b className={num}>{d.open_sessions_count}</b></span>
                      ) : (
                        <span className="text-emerald-700">{t(d.active ? "متاح" : "مؤرشف")}</span>
                      )}
                    </div>
                    {mineHere ? (
                      <PosButton className="h-9 px-3" onClick={() => navigate("/pos/sell")}><Play className="h-4 w-4" />{t("متابعة")}</PosButton>
                    ) : d.can_open && !mySession ? (
                      <PosButton className="h-9 px-3" onClick={() => setOpening(d)}><Play className="h-4 w-4" />{t("فتح جلسة")}</PosButton>
                    ) : open && !mineHere && sessionsLevel !== "none" ? (
                      <Link to={`/pos/sessions/${open.id}`}><PosButton variant="outline" className="h-9 px-3">{t("الجلسة")}</PosButton></Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {archivedCount > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-sm font-semibold text-[#0f6b63] hover:underline">
            {t(showArchived ? "إخفاء الأجهزة المؤرشفة" : "عرض الأجهزة المؤرشفة")} ({archivedCount})
          </button>
        )}

        {opening && (
          <OpenSessionDialog device={opening} onClose={() => setOpening(null)} onOpened={() => navigate("/pos/sell")} />
        )}
        {editing && setup && (
          <DeviceDialog device={editing === "new" ? null : editing} setup={setup} onClose={() => setEditing(null)}
            onSaved={async (saved, created) => {
              setEditing(null);
              toast({
                title: t(created ? "أُضيف الجهاز" : "حُفظ الجهاز"),
                description: saved.device_type === "cash_box" && created ? `${t("حساب الصندوق")}: ${saved.cash_account_code} — ${saved.cash_account_name ?? ""}` : saved.name,
              });
              await load();
            }} />
        )}
        {editing && !setup && (
          <PosModal title="الأجهزة" onClose={() => setEditing(null)}><ErrorNote message={t("تعذر تحميل بيانات الإعداد؛ أعد المحاولة")} /></PosModal>
        )}
        {confirm && (
          <PosConfirm
            title={confirm.action === "delete" ? "حذف الجهاز" : confirm.action === "archive" ? "أرشفة الجهاز" : "إعادة تفعيل الجهاز"}
            message={confirm.action === "delete"
              ? "يُحذف الجهاز، ويُحذف حساب صندوقه من الدليل والحسابات البنكية إن لم يُرحَّل عليه شيء."
              : confirm.action === "archive"
                ? "لا تُفتح عليه جلسات جديدة، وتبقى جلساته وتقاريره كما هي. يمكن إعادة تفعيله لاحقًا."
                : "يعود متاحًا لفتح الجلسات لمستخدميه."}
            confirmLabel={confirm.action === "delete" ? "حذف" : confirm.action === "archive" ? "أرشفة" : "إعادة تفعيل"}
            danger={confirm.action === "delete"}
            busy={busy}
            onConfirm={() => void runConfirm()}
            onClose={() => setConfirm(null)}
          >
            <p className="mt-2 text-sm font-semibold text-slate-900">{confirm.device.name}</p>
          </PosConfirm>
        )}
      </main>
    </Layout>
  );
}

/** فتح جلسة: رصيد الافتتاح هو رصيد حساب الصندوق (أو عهدة الموظف) في الدفتر */
function OpenSessionDialog({ device, onClose, onOpened }: { device: PosDevice; onClose: () => void; onOpened: () => void }) {
  const { t } = useI18n();
  const money = useMoney();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    setError("");
    const result = await openPosSession(device.id, note.trim());
    setBusy(false);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    onOpened();
  };
  return (
    <PosModal title="فتح جلسة" onClose={onClose} busy={busy}
      footer={<><PosButton variant="outline" onClick={onClose} disabled={busy}>{t("إلغاء")}</PosButton><PosButton onClick={() => void open()} busy={busy}><Play className="h-4 w-4" />{t("فتح الجلسة والبدء")}</PosButton></>}>
      <div className="space-y-3">
        <div className="rounded-xl border bg-slate-50 p-4 text-sm">
          <div className="font-bold text-slate-900">{device.name}</div>
          <div className="mt-1 text-slate-600">{device.warehouse_name}</div>
          <div className="mt-2 text-xs leading-6 text-slate-600">
            {device.device_type === "cash_box"
              ? <>{t("رصيد الافتتاح: رصيد الصندوق الآن")} {device.cash_balance !== null && <b className={num}>{money(device.cash_balance)}</b>}</>
              : t("رصيد الافتتاح: رصيد عهدتك في الدفتر الآن")}
          </div>
        </div>
        <p className="text-xs leading-6 text-slate-500">
          {t("أثناء فتح الجلسة يُقفل حسابها: لا يُرحَّل عليه قيد من خارج الجلسة حتى إغلاقها.")}
        </p>
        <label className={posLabel}>{t("ملاحظة الافتتاح (اختياري)")}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={posInput} autoFocus />
        </label>
        <ErrorNote message={error} />
      </div>
    </PosModal>
  );
}

/** إضافة جهاز أو تعديله */
function DeviceDialog({ device, setup, onClose, onSaved }: {
  device: PosDevice | null; setup: PosSettingsPayload; onClose: () => void; onSaved: (device: PosDevice, created: boolean) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<DeviceForm>(() => ({
    name: device?.name ?? "",
    deviceType: device?.device_type ?? "cash_box",
    warehouseId: device?.warehouse_id ?? setup.warehouses[0]?.id ?? "",
    cardAccount: device?.card_account_code ?? "",
    branchIds: device?.branch_ids ?? [],
    userIds: device?.user_ids ?? [],
    notes: device?.notes ?? "",
  }));
  const [userQuery, setUserQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const typeLocked = Boolean(device && device.sessions_count > 0);
  const banks = setup.bank_accounts.filter((b) => b.account_kind === "bank");
  const users = setup.users.filter((u) => !userQuery.trim() || (u.name ?? "").includes(userQuery.trim()));
  const toggle = (key: "branchIds" | "userIds", id: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const save = async () => {
    if (!form.name.trim()) { setError(t("اسم الجهاز مطلوب")); return; }
    if (!form.warehouseId) { setError(t("اختر مستودعًا فعالًا")); return; }
    setBusy(true);
    setError("");
    const result = await savePosDevice(device?.id ?? null, {
      name: form.name.trim(), device_type: form.deviceType, warehouse_id: form.warehouseId,
      card_account_code: form.cardAccount || null, branch_ids: form.branchIds, user_ids: form.userIds, notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (result.error || !result.data) { setError(posErrorText(result.error ?? "", t)); return; }
    onSaved(result.data, !device);
  };

  return (
    <PosModal title={device ? "تعديل الجهاز" : "جهاز جديد"} onClose={onClose} busy={busy} size="lg"
      footer={<><PosButton variant="outline" onClick={onClose} disabled={busy}>{t("إلغاء")}</PosButton><PosButton onClick={() => void save()} busy={busy}>{t("حفظ الجهاز")}</PosButton></>}>
      <div className="space-y-4">
        <label className={posLabel}>{t("اسم الجهاز")}
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={80} className={posInput} autoFocus placeholder={t("مثل: الكاشير الرئيسي، مندوب الشرقية")} />
        </label>
        <div>
          <span className={posLabel}>{t("نوع الجهاز")}</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {DEVICE_TYPES.map((type) => (
              <button key={type.value} type="button" disabled={typeLocked && type.value !== form.deviceType}
                onClick={() => setForm((f) => ({ ...f, deviceType: type.value }))}
                className={cn("rounded-xl border p-3 text-start disabled:opacity-40",
                  form.deviceType === type.value ? "border-[#0f6b63] bg-[#e6f2f0]" : "border-slate-300 hover:bg-slate-50")}>
                <span className="block text-sm font-bold text-slate-900">{t(type.label)}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600">{t(type.hint)}</span>
              </button>
            ))}
          </div>
          {typeLocked && <p className="mt-1 text-xs text-slate-500">{t("نوع الجهاز لا يتغير بعد فتح جلسات عليه")}</p>}
          {!device && form.deviceType === "cash_box" && (
            <p className="mt-1 text-xs text-slate-500">{t("يُنشأ للصندوق حساب نقدية تحت «صناديق نقاط البيع» ضمن النقد وما يعادله، ويظهر في الحسابات البنكية.")}</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={posLabel}>{t("المستودع (يُصرف منه المخزون)")}
            <select value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))} className={posSelect}>
              {setup.warehouses.length === 0 && <option value="">{t("لا مستودعات فعالة")}</option>}
              {setup.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name_ar}</option>)}
            </select>
          </label>
          <label className={posLabel}>{t("حساب البطاقة (حساب بنكي)")}
            <select value={form.cardAccount} onChange={(e) => setForm((f) => ({ ...f, cardAccount: e.target.value }))} className={posSelect}>
              <option value="">{t("بلا بيع بالبطاقة")}</option>
              {banks.map((b) => <option key={b.account_code} value={b.account_code}>{b.account_code} — {b.name}</option>)}
            </select>
          </label>
        </div>
        {setup.branches.length > 0 && (
          <div>
            <span className={posLabel}>{t("الفروع (بلا اختيار: كل الفروع)")}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {setup.branches.map((b) => (
                <label key={b.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                  form.branchIds.includes(b.id) ? "border-[#0f6b63] bg-[#e6f2f0]" : "border-slate-300")}>
                  <input type="checkbox" checked={form.branchIds.includes(b.id)} onChange={() => toggle("branchIds", b.id)} />{b.name}
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className={posLabel}>{t("المستخدمون (بلا اختيار: كل من له صلاحية البيع)")}</span>
          <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} className={posInput} placeholder={t("ابحث بالاسم")} />
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border">
            {users.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">{t("لا نتائج")}</p> : users.map((u) => (
              <label key={u.user_id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50">
                <input type="checkbox" checked={form.userIds.includes(u.user_id)} onChange={() => toggle("userIds", u.user_id)} />
                {u.name ?? u.user_id}
              </label>
            ))}
          </div>
          {form.userIds.length > 0 && <p className="mt-1 text-xs text-slate-500">{t("المختارون")}: {form.userIds.length}</p>}
        </div>
        <label className={posLabel}>{t("ملاحظات")}
          <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} maxLength={300} className={posInput} />
        </label>
        <ErrorNote message={error} />
      </div>
    </PosModal>
  );
}
