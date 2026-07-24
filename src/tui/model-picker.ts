/**
 * Model picker: TUI component matching pi's native `/model` UX.
 *
 * Pattern follows pi's ModelSelectorComponent:
 *   - Input takes focus, receives all non-navigation keys
 *   - Component intercepts up/down/pageUp/pageDown/enter/esc in handleInput
 *   - listContainer holds exactly maxVisible Text rows; updateList() redraws
 *   - fuzzyFilter from pi-tui for real-time incremental filtering
 */
import { Container, Input, Text, Spacer, fuzzyFilter, getKeybindings } from "@earendil-works/pi-tui";
import type { Focusable } from "@earendil-works/pi-tui";
import { getSelectListTheme } from "@earendil-works/pi-coding-agent";

export interface PickerModelItem {
	provider: string;
	id: string;
	cost: { input: number };
}

export interface PickerResult {
	provider: string;
	model: string;
}

const MAX_VISIBLE = 10;

export interface PickerOptions {
	items: PickerModelItem[];
	selectedKey: string | null;
	tierLabel: string;
	onSelect: (result: PickerResult) => void;
	onCancel: () => void;
}

function searchText(item: PickerModelItem): string {
	return `${item.id} ${item.provider}`;
}

export class ModelPickerComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allItems: PickerModelItem[];
	private filteredItems: PickerModelItem[] = [];
	private selectedIndex = 0;
	private onSelect: (r: PickerResult) => void;
	private onCancel: () => void;

	// Focusable: route focus to searchInput
	private _focused = false;
	get focused(): boolean { return this._focused; }
	set focused(v: boolean) { this._focused = v; this.searchInput.focused = v; }

	constructor(opts: PickerOptions) {
		super();

		this.allItems = opts.items;
		this.onSelect = opts.onSelect;
		this.onCancel = opts.onCancel;

		const theme = getSelectListTheme();

		// Header
		this.addChild(new Text(theme.selectedText(`Select model for ${opts.tierLabel}`), 0, 0));
		this.addChild(new Spacer(1));

		// Search input
		this.searchInput = new Input();
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		// List container (will be populated by updateList)
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Footer hint
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.description("Type to filter · ↑↓ navigate · Enter select · Esc cancel"), 0, 0));

		// Initial population
		this.filterModels("");

		// Pre-select current model
		if (opts.selectedKey) {
			const idx = this.filteredItems.findIndex((m) => `${m.provider}/${m.id}` === opts.selectedKey);
			if (idx >= 0) {
				this.selectedIndex = idx;
				this.updateList();
			}
		}
	}

	private filterModels(query: string): void {
		const q = query.trim();
		this.filteredItems = q
			? fuzzyFilter(this.allItems, q, (m) => searchText(m))
			: this.allItems;
		// Clamp selectedIndex after filter
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		const theme = getSelectListTheme();

		const total = this.filteredItems.length;
		if (total === 0) {
			this.listContainer.addChild(new Text(theme.noMatch("  No matching models"), 0, 0));
			return;
		}

		// Sliding viewport: keep selectedIndex roughly centered
		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), total - MAX_VISIBLE));
		const endIndex = Math.min(startIndex + MAX_VISIBLE, total);

		for (let i = startIndex; i < endIndex; i++) {
			const m = this.filteredItems[i]!;
			const isSelected = i === this.selectedIndex;
			const arrow = isSelected ? theme.selectedPrefix("→ ") : "  ";
			const name = isSelected ? theme.selectedText(m.id) : m.id;
			const badge = theme.description(`[${m.provider}] $${m.cost.input.toFixed(3)}/M`);
			this.listContainer.addChild(new Text(`${arrow}${name} ${badge}`, 0, 0));
		}

		// Scroll indicator
		if (startIndex > 0 || endIndex < total) {
			this.listContainer.addChild(new Text(theme.scrollInfo(`  (${this.selectedIndex + 1}/${total})`), 0, 0));
		}
	}

	private move(delta: number): void {
		const n = this.filteredItems.length;
		if (n === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + n) % n;
		this.updateList();
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		// Cancel
		if (kb.matches(data, "tui.select.cancel")) {
			this.onCancel();
			return;
		}

		// Confirm
		if (kb.matches(data, "tui.select.confirm")) {
			const m = this.filteredItems[this.selectedIndex];
			if (m) this.emitSelect(m);
			return;
		}

		// Navigation
		if (kb.matches(data, "tui.select.up")) { this.move(-1); return; }
		if (kb.matches(data, "tui.select.down")) { this.move(1); return; }
		if (kb.matches(data, "tui.select.pageUp")) { this.move(-MAX_VISIBLE); return; }
		if (kb.matches(data, "tui.select.pageDown")) { this.move(MAX_VISIBLE); return; }

		// Everything else: forward to search input, then refresh filter
		this.searchInput.handleInput(data);
		this.filterModels(this.searchInput.getValue());
	}

	private emitSelect(m: PickerModelItem): void {
		this.onSelect({ provider: m.provider, model: m.id });
	}
}

export function createModelPicker(opts: PickerOptions): ModelPickerComponent {
	return new ModelPickerComponent(opts);
}
