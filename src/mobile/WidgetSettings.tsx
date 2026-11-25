import { useState } from 'react';
import { Field, Segmented } from '@/ui/components';
import { getWidgetOrder, setWidgetOrder, type WidgetOrder } from './widget';
import { WidgetCard } from './WidgetCard';

/**
 * Settings → Widget (iPhone app only): how the widget walks through the saved words, and where the other widget options live.
 * The order is sent to the widget with the words (the widget's own "Thứ tự từ" option can override it).
 */
export function WidgetSettings() {
  const [order, setOrder] = useState<WidgetOrder>(getWidgetOrder());
  return (
    <div className="space-y-5" data-ml-widget-settings="">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">Widget từ vựng</h1>
      <Field label="Thứ tự từ" description="Sau mỗi giờ widget chuyển sang từ khác: ngẫu nhiên trong sổ từ, hoặc lần lượt theo thứ tự trong sổ từ (từ mới nhất trước).">
        <Segmented
          value={order}
          onChange={(v) => {
            setOrder(v);
            setWidgetOrder(v);
          }}
          options={[
            { value: 'random', label: 'Ngẫu nhiên' },
            { value: 'sequential', label: 'Theo thứ tự' },
          ]}
        />
      </Field>
      <div className="rounded-xl bg-text/[0.04] px-3 py-2 text-[12.5px] leading-snug text-muted" data-ml-widget-tips="">
        <b className="text-text">Giao diện và thứ tự riêng cho từng widget:</b> giữ widget trên màn hình chính → Chỉnh sửa widget → Giao diện / Thứ tự từ.
        Bấm vào widget để mở Sổ từ; hai nút ‹ › để về từ trước hoặc sang từ kế tiếp ngay.
      </div>
      <WidgetCard />
    </div>
  );
}
