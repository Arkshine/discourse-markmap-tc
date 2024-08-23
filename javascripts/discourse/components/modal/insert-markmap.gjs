import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { Input } from "@ember/component";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import { service } from "@ember/service";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DToggleSwitch from "discourse/components/d-toggle-switch";
import TextField from "discourse/components/text-field";
import themeI18n from "discourse/helpers/theme-i18n";
import themeSetting from "discourse/helpers/theme-setting";
import i18n from "discourse-common/helpers/i18n";

export default class InsertMarkmap extends Component {
  @service siteSettings;
  @service session;
  @service markmapManager;
  @service markmapInstance;

  @tracked fieldTitle = "";
  @tracked fieldAutoFit = false;

  keyDown(e) {
    if (e.keyCode === 13) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }

  @action
  closeModal() {
    this.args.closeModal();
  }

  @action
  toggleAutoFit() {
    this.fieldAutoFit = !this.fieldAutoFit;
  }

  @action
  insert() {
    let options = [];

    if (this.fieldTitle) {
      options.push(`title="${this.fieldTitle}"`);
    }

    if (this.fieldAutoFit) {
      options.push("auto_fit=true");
    }

    this.args.model.insertMarkmap(
      `\n[wrap=markmap ${options.join(" ")}]\n`,
      "\n[/wrap]\n",
      "markmap_sample",
      {
        useBlockMode: true,
      }
    );

    this.args.closeModal();
  }

  <template>
    <DModal
      @title={{i18n (themePrefix "modal.insert.title")}}
      @closeModal={{this.closeModal}}
      @bodyClass="cooked"
      class="insert-markmap-modal"
    >
      <:body>
        <div class="insert-markmap__form">
          <div class="insert-markmap__input">
            <label>
              {{i18n (themePrefix "modal.insert.form.title.label")}}
            </label>
            <div class="insert-markmap__description">{{i18n
                (themePrefix "modal.insert.form.title.description")
              }}</div>
            <TextField
              @value={{this.fieldTitle}}
              @autofocus="autofocus"
              @autocomplete="off"
            />
          </div>
          <div class="insert-markmap__input">
            <label>
              {{i18n (themePrefix "modal.insert.form.auto_fit.label")}}
            </label>
            <div class="insert-markmap__description">{{i18n
                (themePrefix "modal.insert.form.auto_fit.description")
              }}</div>
            <DToggleSwitch
              @state={{this.fieldAutoFit}}
              {{on "click" this.toggleAutoFit}}
            />
          </div>
        </div>
      </:body>
      <:footer>
        <DButton
          class="btn-primary"
          @label={{themePrefix "modal.actions.insert"}}
          @action={{this.insert}}
        />
      </:footer>
    </DModal>
  </template>
}
