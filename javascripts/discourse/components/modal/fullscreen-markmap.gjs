import Component from "@glimmer/component";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import { service } from "@ember/service";
import DModal from "discourse/components/d-modal";
import i18n from "discourse-common/helpers/i18n";

export default class FullscreenMarkmap extends Component {
  @service siteSettings;
  @service session;
  @service markmapManager;
  @service markmapInstance;

  @action
  closeModal() {
    const { wrapElement } = this.args.model;
    this.markmapInstance.lookup(wrapElement.dataset.handler)?.fit();

    this.args.closeModal();
  }

  @action
  applyMarkmap(element) {
    const modalBodyElement = element.querySelector(".d-modal__body");
    const { wrapElement, attrs } = this.args.model;

    this.markmapManager.renderInModal({
      containerElement: modalBodyElement,
      wrapElement,
      attrs,
    });
  }

  <template>
    <DModal
      @title={{i18n (themePrefix "modal.fullscreen.title")}}
      @closeModal={{this.closeModal}}
      @bodyClass="d-editor-preview"
      class="fullscreen-markmap-modal -max"
      {{didInsert this.applyMarkmap}}
    >
      <:body>
      </:body>
    </DModal>
  </template>
}
