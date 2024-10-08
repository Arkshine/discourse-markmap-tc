import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { htmlSafe } from "@ember/template";
import DButton from "discourse/components/d-button";
import DModal from "discourse/components/d-modal";
import DToggleSwitch from "discourse/components/d-toggle-switch";
import TextField from "discourse/components/text-field";
import concatClass from "discourse/helpers/concat-class";
import i18n from "discourse-common/helpers/i18n";
import I18n from "discourse-i18n";
import { defaultOptions } from "../../lib/markmap/view/constants";

export default class OptionsMarkmap extends Component {
  @service siteSettings;
  @service session;
  @service markmapManager;
  @service markmapInstance;

  @tracked fieldTitle = "";
  @tracked fieldAutoFit = defaultOptions.autoFit;
  @tracked fieldMaxHeight;
  @tracked fieldMaxWidth;

  markmapMatch;
  markmapOptions;

  constructor() {
    super(...arguments);

    if (this.edition && this.wrapElement && this.textArea) {
      const bbcodeRegex = /\[wrap=markmap[^\]]+\]/g;
      const paramsRegex = new RegExp(
        '(?<key1>\\w+)=["“](?<value1>[^"”]*)["”]|(?<key2>\\w+)=(?<value2>[^\\s\\]]+)',
        "g"
      );

      let index = 0;
      let result;

      while ((result = bbcodeRegex.exec(this.textArea.value)) !== null) {
        if (index === this.handlerIndex) {
          this.markmapMatch = result;
          break;
        }
        ++index;
      }

      if (!this.markmapMatch) {
        return;
      }

      let params = {};

      while ((result = paramsRegex.exec(this.markmapMatch[0])) !== null) {
        const { key1, value1, key2, value2 } = result.groups;
        params[key1 || key2] = value1 || value2;
      }

      if (Object.keys(params).length > 0) {
        params = this.markmapInstance.deriveOptions(params, {
          useDefault: false,
        });
      }

      this.markmapOptions = {
        ...this.markmapInstance.deriveOptions(this.wrapElement.dataset),
        ...params,
      };

      this.fieldTitle = this.markmapOptions.title;
      this.fieldAutoFit = this.markmapOptions.autoFit;
      this.fieldMaxHeight = this.markmapOptions.maxHeight;
      this.fieldMaxWidth = this.markmapOptions.maxWidth;
    }
  }

  get handler() {
    const { element } = this.args.model;
    return element.dataset.handler;
  }

  get handlerIndex() {
    return parseInt(this.handler.split(".")[1], 10);
  }

  get insideWrapMarkmap() {
    if (!this.textArea) {
      return false;
    }

    const cursorPosition = this.textArea.selectionStart;
    const textUpToCursor = this.textArea.value.substring(0, cursorPosition);

    return textUpToCursor.lastIndexOf("[wrap=markmap") !== -1;
  }

  get textArea() {
    return document.querySelector(".d-editor-textarea-wrapper textarea");
  }

  get wrapElement() {
    if (!this.handler) {
      return null;
    }

    const svgWrapper = document.querySelector(
      `svg[data-handler="${this.handler}"]`
    );
    const element = svgWrapper?.parentElement?.previousElementSibling;

    if (!element || element.dataset.wrap !== "markmap") {
      return null;
    }

    return element;
  }

  get edition() {
    return !!this.args.model.wrapElement || this.insideWrapMarkmap;
  }

  get hasErrorOnEdition() {
    return this.edition && !this.markmapMatch;
  }

  get title() {
    return I18n.t(
      themePrefix(this.edition ? "modal.edit.title" : "modal.insert.title")
    );
  }

  get saveLabel() {
    return I18n.t(
      themePrefix(
        this.edition ? "modal.actions.update" : "modal.actions.insert"
      )
    );
  }

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
    this.textArea.focus();
  }

  @action
  toggleAutoFit() {
    this.fieldAutoFit = !this.fieldAutoFit;
  }

  @action
  save() {
    let options = [];

    if (this.fieldTitle) {
      options.push(`title="${this.fieldTitle.replace('"', "'")}"`);
    }

    options.push(`autoFit=${this.fieldAutoFit ? "true" : "false"}`);

    if (this.fieldMaxHeight) {
      options.push(`maxHeight=${this.fieldMaxHeight}`);
    }

    if (this.fieldMaxWidth) {
      options.push(`maxWidth=${this.fieldMaxWidth}`);
    }

    if (this.edition) {
      const { element, postId } = this.args.model;
      const { index } = element.dataset;
      const postHandler = this.markmapManager.uniqueKey({
        isPreview: false,
        index,
        postId,
      });

      this.markmapInstance.resetRenderCounts([this.handler, postHandler]);
      this.markmapInstance.lookup(this.handler)?.setOptions({
        title: this.fieldTitle,
        autoFit: this.fieldAutoFit,
        maxHeight: this.fieldMaxHeight,
        maxWidth: this.fieldMaxWidth,
      });

      const textArea = document.querySelector(
        ".d-editor-textarea-wrapper textarea"
      );

      textArea.setSelectionRange(
        this.markmapMatch.index,
        this.markmapMatch.index + this.markmapMatch[0].length
      );
      textArea.focus();
      document.execCommand(
        "insertText",
        false,
        `[wrap=markmap ${options.join(" ")}]`
      );
    } else {
      this.args.model.insertMarkmap(
        "\n[wrap=markmap " + options.join(" ") + "]\n",
        "\n[/wrap]\n",
        "markmap_sample",
        {
          useBlockMode: true,
        }
      );
    }

    this.args.closeModal();
  }

  <template>
    {{#if this.hasErrorOnEdition}}
      <DModal
        @title={{this.title}}
        @closeModal={{this.closeModal}}
        class="options-markmap-modal--error"
      >
        <:body>
          <div class="options-markmap__form">
            <div class="options-markmap__error">
              {{i18n (themePrefix "modal.edit.error")}}
            </div>
          </div>
        </:body>
        <:footer>
          <DButton class="btn-primary" @label="close" @action={{@closeModal}} />
        </:footer>
      </DModal>
    {{else}}
      <DModal
        @title={{this.title}}
        @closeModal={{this.closeModal}}
        class={{concatClass
          "options-markmap-modal"
          (if this.edition "--edit" "--insert")
        }}
      >
        <:body>
          <div class="options-markmap__form">
            <div class="options-markmap__input">
              <label>
                {{i18n (themePrefix "modal.options.form.title.label")}}
              </label>
              <div class="options-markmap__description">{{htmlSafe
                  (i18n (themePrefix "modal.options.form.title.description"))
                }}</div>
              <TextField
                @value={{this.fieldTitle}}
                @autofocus="autofocus"
                @autocomplete="off"
              />
            </div>
            <div class="options-markmap__input">
              <label>
                {{i18n (themePrefix "modal.options.form.max_height.label")}}
              </label>
              <div class="options-markmap__description">{{htmlSafe
                  (i18n
                    (themePrefix "modal.options.form.max_height.description")
                  )
                }}</div>
              <TextField
                @value={{this.fieldMaxHeight}}
                @autofocus="autofocus"
                @autocomplete="off"
              />
            </div>
            <div class="options-markmap__input">
              <label>
                {{i18n (themePrefix "modal.options.form.max_node_width.label")}}
              </label>
              <div class="options-markmap__description">{{htmlSafe
                  (i18n
                    (themePrefix
                      "modal.options.form.max_node_width.description"
                    )
                  )
                }}</div>
              <TextField
                @value={{this.fieldMaxWidth}}
                @autofocus="autofocus"
                @autocomplete="off"
              />
            </div>
            <div class="options-markmap__input">
              <label>
                {{i18n (themePrefix "modal.options.form.auto_fit.label")}}
              </label>
              <div class="options-markmap__description">{{htmlSafe
                  (i18n (themePrefix "modal.options.form.auto_fit.description"))
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
            @translatedLabel={{this.saveLabel}}
            @action={{this.save}}
          />
        </:footer>
      </DModal>
    {{/if}}
  </template>
}
