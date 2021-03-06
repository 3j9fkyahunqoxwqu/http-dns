"use strict";

/* global browser */
const STUDY_URL = browser.extension.getURL("study.html");
const SETTING_NAME = "trr";
const baseStudySetup = {
  activeExperimentName: browser.runtime.id,
  studyType: "shield",
  // telemetry
  telemetry: {
    // default false. Actually send pings.
    send: true,
    // Marks pings with testing=true.  Set flag to `true` before final release
    removeTestingFlag: false,
  },
  endings: {
    // standard endings
    "user-disable": {
      baseUrls: [],
      category: "ended-negative",
    },
    ineligible: {
      baseUrls: [],
      category: "ended-neutral",
    },
    expired: {
      baseUrls: [],
      category: "ended-positive",
    },

    // custom endings
    UIDisabled: {
      baseUrls: [],
      category: "ended-negative",
    },
  },
  weightedVariations: [
    {
      name: "trr-active",
      weight: 1
    },
    {
      name: "control",
      weight: 1
    },
/*
    {
      name: "trr-study",
      weight: 1.5
    },
*/
  ],
  // maximum time that the study should run, from the first run
  expire: {
    days: 21,
  },
  allowEnroll: true,
};

const stateManager = {
  _settingName: null,

  set settingName(settingName) {
    if (this._settingName == null) {
      this._settingName = settingName;
    } else {
      throw new Error("already set setting");
    }
  },

  get settingName() {
    if (this._settingName == null) {
      throw new Error("set setting not set");
    } else {
      return this._settingName;
    }
  },

  async getState() {
    return await browser.experiments.settings.get(this.settingName) || null;
  },

  async setState(stateKey) {
    browser.study.sendTelemetry({stateKey});
    browser.experiments.settings.set(this.settingName, stateKey);
  },

  /* settingName impacts the active states file we will be getting:
     trr-active, trr-study
   */
  async setSetting(settingName) {
    stateManager.settingName = settingName;
    return browser.experiments.settings.add(this.settingName);
  },

  endStudy(stateKey) {
    browser.study.sendTelemetry({stateKey, disabling: "yes"});
    browser.study.endStudy(stateKey || "generic");
  },

  // Clear out settings
  async clear(stateKey = null) {
    browser.experiments.settings.clear(stateKey);
  }
};

const rollout = {
  async init() {
    browser.study.onEndStudy.addListener((ending) => {
      //TODO make sure we handle all endings here
      stateManager.clear(ending);
    });
    browser.study.onReady.addListener(() => {
      this.onReady()
    });
    await browser.study.setup(baseStudySetup);
    browser.runtime.onMessage.addListener((...args) => this.handleMessage(...args));
  },
  async onReady() {
    const studyInfo = await browser.study.getStudyInfo();
    if (!studyInfo.isFirstRun) {
      return;
    }
    // If the user hasn't met the criteria clean up
    if (await browser.experiments.settings.hasModifiedPrerequisites()) {
      stateManager.endStudy("ineligible");
    }
    const variation = studyInfo.variation.name;
    if (variation == "control") {
      // Return early as we don't have a control.json file
      return;
    }
    await stateManager.setSetting(variation);
    const stateName = await stateManager.getState();
    switch (stateName) {
    case "enabled":
    case "disabled":
    case "UIDisabled":
    case "UIOk":
    case "uninstalled":
    case null:
      await stateManager.setState("loaded");
      await this.show();
      break;
      // If the user has a thrown error show the banner again (shouldn't happen)
    case "loaded":
      await this.show();
      break;
    }
  },

  async handleMessage(message) {
    switch (message.method) {
    case "UIDisable":
      await this.handleUIDisable();
      break;
    case "UIOK":
      await this.handleUIOK();
      break;
    }
  },

  async handleUIOK() {
    await stateManager.setState("UIOk");
    browser.experiments.notifications.clear("rollout-prompt");
  },

  async handleUIDisable() {
    const tabs = await browser.tabs.query({
      url: STUDY_URL
    });
    browser.tabs.remove(tabs.map((tab) => tab.id));
    browser.experiments.notifications.clear("rollout-prompt");
    stateManager.endStudy("UIDisabled");
  },

  async show() {
    // This doesn't handle the 'x' clicking on the notification mostly because it's not clear what the user intended here.
    browser.experiments.notifications.onButtonClicked.addListener((options) => {
      switch (Number(options.buttonIndex)) {
      case 1:
        this.handleUIOK();
        break;
      case 0:
        this.handleUIDisable();
        break;
      }
    });
    browser.experiments.notifications.create("rollout-prompt", {
      type: "prompt",
      title: "",
      message: browser.i18n.getMessage("notificationMessage"),
      buttons: [
        {title: browser.i18n.getMessage("disableButtonText")},
        {title: browser.i18n.getMessage("acceptButtonText")}
      ],
      moreInfo: {
        url: STUDY_URL,
        title: browser.i18n.getMessage("learnMoreLinkText")
      }
    });
    // Set enabled state last in-case the code above fails.
    await stateManager.setState("enabled");
  }
};

rollout.init();

