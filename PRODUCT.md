# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the owner-installer of 대한인테리어필름, a 대구/경북 interior-work business (film wrapping, lighting, ceiling fans, sink and toilet replacement, glass tinting, screens). They use the app on a phone, standing in a customer's home, often one-handed, with unreliable site Wi-Fi. Their job is to photograph the space, mark the areas to be worked, choose materials and colors, and produce a quote on the spot.

The customer is a second, live audience: the owner turns the screen toward them to show the quote and the rendered preview while the decision is being made. Prospective customers are a third audience. They read the public 시공 후기 blog, which they can search by customer name.

## Product Purpose

Turn a site photo into a priced quote and a realistic "after" preview in one visit. The AI recognizes surfaces and objects in the photo (cabinet doors, ceiling, door frames), the owner assigns work items and materials to them, and the backend computes an itemized quote: materials, labor, sundries, VAT. Completed jobs can become a 시공 후기 blog post with before/after photos, used as marketing. Success is the customer saying yes before the owner leaves the house, and a quote the owner trusts without recalculating by hand.

## Positioning

Built around one trade's real arithmetic and one owner's price list. The quote follows how the work is actually priced: film bought by the meter off a 1.22 m roll with a loss allowance, labor in 품 (man-days) by difficulty per surface, editable unit prices. The preview recolors the customer's own photo, not a stock render. A generic estimator or a visualizer app can't copy that fit.

## Operating Context

- Flow: 1) site (photo, customer name), 2) work items (grouped: film family, glass, ceiling, plumbing/kitchen, window parts), 3) mapping regions to materials on the photo, then the result with preview and invoice.
- Server processing (segmentation, vision, rendering) takes tens of seconds to minutes; the UI must keep the owner and the customer informed through slow steps rather than fail.
- Quotes are saved and reopened from "불러오기". Unit prices are adjusted in the app (long-press the 대한인테리어필름 banner → 단가 설정) because field prices vary by region, season and supplier.
- Delivered as a Next.js PWA and an Android APK (Capacitor) talking to a remote FastAPI backend. The Android back button must be handled.
- All UI copy is Korean.

## Capabilities and Constraints

- Work items: 필름 (싱크대/상하부장, 샷시, 문짝/문틀, 장롱/옷장, 벽면 시트지), 유리 썬팅/일러스트, 조명/다운라이트, 실링팬, 싱크볼, 변기, 미세방충망.
- Photo sources: camera and gallery. Regions are marked automatically or by hand (shape/mask editing on canvas).
- Previews: color change on film work is a lightness-preserving recolor; new fixtures (lights, fans, sinks) are inpainted. Preview fidelity is an honest limit, so results are shown as a simulation.
- Quote output: itemized invoice with 자재 내역 / 인건비 / 부자재·경비 sections.
- Business identity (name, phone 010-7664-8007, service area) is fixed data, never AI-generated, because a mistyped number costs jobs.
- Platform is web only (PWA + Android APK). iOS is not a target.

## Brand Commitments

Business name 대한인테리어필름. Phone and service area come verbatim from `backend/app/business_info.py`. The current app name is 대한인테리어필름.

## Evidence on Hand

Ten pattern swatches in `backend/assets/patterns/`, two fixture images in `backend/assets/fixtures/`, and app icons in `frontend/public/icons/`. Real 시공 후기 posts and photos exist only as runtime data in `backend/storage/`. No testimonials, customer counts, or completed-job numbers are recorded here; do not invent them.

## Product Principles

1. The phone in a stranger's living room is the real environment. Big targets, one-handed reach, little typing, and no state lost when the network drops.
2. The customer is watching. Every screen the owner might turn around must look trustworthy and clear, and must not leak internal working detail.
3. Numbers are the product. Prices, areas and totals must be legible, traceable to their line items, and adjustable by the owner.
4. Slow AI work is normal. Show progress and keep going instead of failing; label simulations as simulations.
5. The owner's name and phone number are the marketing. Public pages carry the business identity exactly, and never anything invented.

## Accessibility & Inclusion

No formal standard or specific user need has been confirmed. Working assumption, not confirmed: the screen is read in varied indoor light, so contrast and text size stay generous.
