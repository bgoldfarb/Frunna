package expo.modules.appleintelligence

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoAppleIntelligenceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAppleIntelligence")

    AsyncFunction("queryAsync") { _: String ->
      throw UnsupportedOperationException(
        "Apple Intelligence querying is only available on iOS devices that support Apple Intelligence."
      )
    }

    AsyncFunction("requestHealthAuthorizationAsync") {
      throw UnsupportedOperationException("HealthKit is only available on iOS.")
    }

    AsyncFunction("getStepCountsAsync") { _: Int ->
      throw UnsupportedOperationException("HealthKit is only available on iOS.")
    }

    AsyncFunction("getHealthSummaryAsync") { _: Int ->
      throw UnsupportedOperationException("HealthKit is only available on iOS.")
    }

    AsyncFunction("requestCalendarAccessAsync") {
      throw UnsupportedOperationException("Calendar sync is only available on iOS.")
    }

    AsyncFunction("syncCalendarEventsAsync") { _: List<Map<String, String>> ->
      throw UnsupportedOperationException("Calendar sync is only available on iOS.")
    }

    AsyncFunction("removeCalendarEventsAsync") { _: List<String> ->
      throw UnsupportedOperationException("Calendar sync is only available on iOS.")
    }

    AsyncFunction("setStoredValueAsync") { _: String, _: String ->
      throw UnsupportedOperationException("Native storage is only available on iOS.")
    }

    AsyncFunction("getStoredValueAsync") { _: String ->
      throw UnsupportedOperationException("Native storage is only available on iOS.")
    }

    AsyncFunction("removeStoredValueAsync") { _: String ->
      throw UnsupportedOperationException("Native storage is only available on iOS.")
    }
  }
}
