import ExpoModulesCore
import EventKit
import HealthKit

#if canImport(FoundationModels)
import FoundationModels
#endif

public class ExpoAppleIntelligenceModule: Module {
  private let healthStore = HKHealthStore()
  private let eventStore = EKEventStore()

  public func definition() -> ModuleDefinition {
    Name("ExpoAppleIntelligence")

    AsyncFunction("queryAsync") { (prompt: String) async throws -> [String: String] in
      let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmedPrompt.isEmpty {
        throw InvalidPromptException()
      }

      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let session = LanguageModelSession()
        let response = try await session.respond(to: trimmedPrompt)
        return ["text": response.content]
      }
      throw UnsupportedOSErrorException()
      #else
      throw MissingFrameworkException()
      #endif
    }

    AsyncFunction("requestHealthAuthorizationAsync") { () async throws -> Bool in
      try await self.requestHealthAuthorization()
    }

    AsyncFunction("getStepCountsAsync") { (days: Int) async throws -> [[String: Any]] in
      let boundedDays = min(max(days, 1), 365)
      return try await self.fetchStepCounts(days: boundedDays)
    }

    AsyncFunction("getHealthSummaryAsync") { (days: Int) async throws -> [String: Any] in
      let boundedDays = min(max(days, 1), 365)
      return [
        "steps": try await self.fetchStepCounts(days: boundedDays),
        "restingHeartRate": try await self.fetchAverageRestingHeartRate(days: boundedDays),
        "heartRate": try await self.fetchAverageHeartRate(days: boundedDays),
        "sleep": try await self.fetchSleepHours(days: boundedDays),
        "hrv": try await self.fetchAverageHrv(days: boundedDays),
        "vo2Max": try await self.fetchAverageVo2Max(days: boundedDays),
        "activeEnergy": try await self.fetchActiveEnergy(days: boundedDays),
        "distanceWalkingRunning": try await self.fetchDistanceWalkingRunning(days: boundedDays),
        "workouts": try await self.fetchWorkouts(days: boundedDays)
      ]
    }

    AsyncFunction("requestCalendarAccessAsync") { () async throws -> Bool in
      try await self.requestCalendarAccess()
    }

    AsyncFunction("syncCalendarEventsAsync") { (events: [[String: String]]) async throws -> [String] in
      try await self.syncCalendarEvents(events)
    }

    AsyncFunction("removeCalendarEventsAsync") { (eventIds: [String]) async throws -> Int in
      try self.removeCalendarEvents(eventIds)
    }

    AsyncFunction("setStoredValueAsync") { (key: String, value: String) async throws -> Bool in
      try self.setStoredValue(key: key, value: value)
    }

    AsyncFunction("getStoredValueAsync") { (key: String) async throws -> String? in
      try self.getStoredValue(key: key)
    }

    AsyncFunction("removeStoredValueAsync") { (key: String) async throws -> Bool in
      try self.removeStoredValue(key: key)
    }
  }

  private func setStoredValue(key: String, value: String) throws -> Bool {
    let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedKey.isEmpty else {
      throw StorageKeyException()
    }
    UserDefaults.standard.set(value, forKey: trimmedKey)
    return true
  }

  private func getStoredValue(key: String) throws -> String? {
    let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedKey.isEmpty else {
      throw StorageKeyException()
    }
    return UserDefaults.standard.string(forKey: trimmedKey)
  }

  private func removeStoredValue(key: String) throws -> Bool {
    let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedKey.isEmpty else {
      throw StorageKeyException()
    }
    UserDefaults.standard.removeObject(forKey: trimmedKey)
    return true
  }

  private func requestCalendarAccess() async throws -> Bool {
    if #available(iOS 17.0, *) {
      return try await withCheckedThrowingContinuation { continuation in
        eventStore.requestWriteOnlyAccessToEvents { granted, error in
          if let error {
            continuation.resume(throwing: CalendarAccessException(error.localizedDescription))
            return
          }
          continuation.resume(returning: granted)
        }
      }
    }

    return try await withCheckedThrowingContinuation { continuation in
      eventStore.requestAccess(to: .event) { granted, error in
        if let error {
          continuation.resume(throwing: CalendarAccessException(error.localizedDescription))
          return
        }
        continuation.resume(returning: granted)
      }
    }
  }

  private func syncCalendarEvents(_ events: [[String: String]]) async throws -> [String] {
    let granted = try await requestCalendarAccess()
    guard granted else {
      throw CalendarAccessDeniedException()
    }

    guard let calendar = eventStore.defaultCalendarForNewEvents else {
      throw CalendarUnavailableException()
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let fallbackFormatter = ISO8601DateFormatter()
    fallbackFormatter.formatOptions = [.withInternetDateTime]

    var createdIds: [String] = []
    for eventPayload in events {
      guard
        let title = eventPayload["title"],
        let startString = eventPayload["startDate"],
        let endString = eventPayload["endDate"]
      else {
        continue
      }

      guard
        let startDate = formatter.date(from: startString) ?? fallbackFormatter.date(from: startString),
        let endDate = formatter.date(from: endString) ?? fallbackFormatter.date(from: endString)
      else {
        continue
      }

      let event = EKEvent(eventStore: eventStore)
      event.calendar = calendar
      event.title = title
      event.startDate = startDate
      event.endDate = endDate
      event.notes = eventPayload["notes"]

      do {
        try eventStore.save(event, span: .thisEvent, commit: false)
        if let id = event.eventIdentifier {
          createdIds.append(id)
        }
      } catch {
        throw CalendarSyncException(error.localizedDescription)
      }
    }

    do {
      try eventStore.commit()
    } catch {
      throw CalendarSyncException(error.localizedDescription)
    }

    return createdIds
  }

  private func removeCalendarEvents(_ eventIds: [String]) throws -> Int {
    var removedCount = 0
    for id in eventIds {
      guard let event = eventStore.event(withIdentifier: id) else {
        continue
      }
      do {
        try eventStore.remove(event, span: .thisEvent, commit: false)
        removedCount += 1
      } catch {
        throw CalendarRemoveException(error.localizedDescription)
      }
    }

    do {
      try eventStore.commit()
    } catch {
      throw CalendarRemoveException(error.localizedDescription)
    }
    return removedCount
  }

  private func requestHealthAuthorization() async throws -> Bool {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw HealthDataUnavailableException()
    }

    guard
      let stepType = HKObjectType.quantityType(forIdentifier: .stepCount),
      let restingHeartRateType = HKObjectType.quantityType(forIdentifier: .restingHeartRate),
      let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
      let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
      let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
      let vo2Type = HKObjectType.quantityType(forIdentifier: .vo2Max),
      let activeEnergyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
      let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
    else {
      throw HealthTypeUnavailableException()
    }

    let readTypes: Set<HKObjectType> = [
      stepType,
      restingHeartRateType,
      heartRateType,
      sleepType,
      hrvType,
      vo2Type,
      activeEnergyType,
      distanceType,
      HKWorkoutType.workoutType()
    ]

    return try await withCheckedThrowingContinuation { continuation in
      healthStore.requestAuthorization(toShare: [], read: readTypes) { success, error in
        if let error {
          continuation.resume(throwing: HealthAuthorizationException(error.localizedDescription))
          return
        }

        continuation.resume(returning: success)
      }
    }
  }

  private func dateRange(days: Int) throws -> (startDate: Date, endDate: Date, anchorDate: Date) {
    let calendar = Calendar.current
    let todayStart = calendar.startOfDay(for: Date())

    guard let startDate = calendar.date(byAdding: .day, value: -(days - 1), to: todayStart),
      let endDate = calendar.date(byAdding: .day, value: 1, to: todayStart)
    else {
      throw HealthQueryException("Unable to calculate date range for query.")
    }

    return (startDate, endDate, todayStart)
  }

  private func fetchStepCounts(days: Int) async throws -> [[String: Any]] {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw HealthDataUnavailableException()
    }

    guard let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: stepType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No step statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let rawCount = statistics.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "steps": Int(rawCount.rounded())
          ])
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchAverageHeartRate(days: Int) async throws -> [[String: Any]] {
    guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )

    let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: heartRateType,
        quantitySamplePredicate: predicate,
        options: .discreteAverage,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No heart-rate statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let avg = statistics.averageQuantity()?.doubleValue(for: bpmUnit) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "avgBpm": Int(avg.rounded())
          ])
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchAverageRestingHeartRate(days: Int) async throws -> [[String: Any]] {
    guard let restingHeartRateType = HKObjectType.quantityType(forIdentifier: .restingHeartRate) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )

    let bpmUnit = HKUnit.count().unitDivided(by: HKUnit.minute())

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: restingHeartRateType,
        quantitySamplePredicate: predicate,
        options: .discreteAverage,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No resting heart-rate statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let avg = statistics.averageQuantity()?.doubleValue(for: bpmUnit) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "restingBpm": Int(avg.rounded())
          ])
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchAverageHrv(days: Int) async throws -> [[String: Any]] {
    guard let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )
    let secondsUnit = HKUnit.second()

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: hrvType,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: nil
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let calendar = Calendar.current

        var sumsByDay = [String: Double]()
        var countsByDay = [String: Int]()

        (samples as? [HKQuantitySample] ?? []).forEach { sample in
          let dayStart = calendar.startOfDay(for: sample.startDate)
          let key = formatter.string(from: dayStart)
          let valueMs = sample.quantity.doubleValue(for: secondsUnit) * 1000.0
          sumsByDay[key, default: 0] += valueMs
          countsByDay[key, default: 0] += 1
        }

        var rows = [[String: Any]]()
        var dayCursor = range.startDate
        while dayCursor < range.endDate {
          let key = formatter.string(from: dayCursor)
          let count = countsByDay[key] ?? 0
          let avg = count > 0 ? (sumsByDay[key] ?? 0) / Double(count) : 0
          rows.append([
            "date": key,
            "hrvMs": Double(round(avg * 10) / 10)
          ])

          guard let nextDay = calendar.date(byAdding: .day, value: 1, to: dayCursor) else {
            break
          }
          dayCursor = nextDay
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchAverageVo2Max(days: Int) async throws -> [[String: Any]] {
    guard let vo2Type = HKObjectType.quantityType(forIdentifier: .vo2Max) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )
    let unit = HKUnit(from: "ml/kg*min")

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: vo2Type,
        quantitySamplePredicate: predicate,
        options: .discreteAverage,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }
        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No VO2 max statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let avg = statistics.averageQuantity()?.doubleValue(for: unit) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "vo2Max": Double(round(avg * 10) / 10)
          ])
        }
        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchActiveEnergy(days: Int) async throws -> [[String: Any]] {
    guard let activeEnergyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )
    let unit = HKUnit.kilocalorie()

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: activeEnergyType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }
        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No active-energy statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let total = statistics.sumQuantity()?.doubleValue(for: unit) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "activeKilocalories": Int(total.rounded())
          ])
        }
        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchDistanceWalkingRunning(days: Int) async throws -> [[String: Any]] {
    guard let distanceType = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )
    let unit = HKUnit.meterUnit(with: .kilo)

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsCollectionQuery(
        quantityType: distanceType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum,
        anchorDate: range.anchorDate,
        intervalComponents: DateComponents(day: 1)
      )

      query.initialResultsHandler = { _, collection, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }
        guard let collection else {
          continuation.resume(throwing: HealthQueryException("No distance statistics were returned."))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var rows = [[String: Any]]()
        collection.enumerateStatistics(from: range.startDate, to: range.endDate) { statistics, _ in
          let total = statistics.sumQuantity()?.doubleValue(for: unit) ?? 0
          rows.append([
            "date": formatter.string(from: statistics.startDate),
            "distanceKm": Double(round(total * 100) / 100)
          ])
        }
        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchSleepHours(days: Int) async throws -> [[String: Any]] {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      throw HealthTypeUnavailableException()
    }

    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: sleepType,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: nil
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        var totalsByDay = [String: Double]()
        (samples as? [HKCategorySample] ?? []).forEach { sample in
          guard self.isAsleepValue(sample.value) else {
            return
          }

          let key = formatter.string(from: Calendar.current.startOfDay(for: sample.startDate))
          totalsByDay[key, default: 0] += sample.endDate.timeIntervalSince(sample.startDate)
        }

        var rows = [[String: Any]]()
        var dayCursor = range.startDate
        while dayCursor < range.endDate {
          let key = formatter.string(from: dayCursor)
          let hours = (totalsByDay[key] ?? 0) / 3600
          rows.append([
            "date": key,
            "hoursAsleep": Double(round(10 * hours) / 10)
          ])

          guard let nextDay = Calendar.current.date(byAdding: .day, value: 1, to: dayCursor) else {
            break
          }
          dayCursor = nextDay
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func fetchWorkouts(days: Int) async throws -> [[String: Any]] {
    let range = try dateRange(days: days)
    let predicate = HKQuery.predicateForSamples(
      withStart: range.startDate,
      end: range.endDate,
      options: .strictStartDate
    )

    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

    return try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(
        sampleType: HKWorkoutType.workoutType(),
        predicate: predicate,
        limit: 100,
        sortDescriptors: [sort]
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: HealthQueryException(error.localizedDescription))
          return
        }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]

        let rows = (samples as? [HKWorkout] ?? []).map { workout in
          [
            "date": formatter.string(from: workout.startDate),
            "activityType": self.workoutName(for: workout.workoutActivityType),
            "durationMinutes": Int((workout.duration / 60).rounded()),
            "energyKilocalories": Int((workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0).rounded())
          ] as [String: Any]
        }

        continuation.resume(returning: rows)
      }

      self.healthStore.execute(query)
    }
  }

  private func isAsleepValue(_ value: Int) -> Bool {
    if value == HKCategoryValueSleepAnalysis.inBed.rawValue {
      return false
    }

    if #available(iOS 16.0, *) {
      let asleepValues: Set<Int> = [
        HKCategoryValueSleepAnalysis.asleep.rawValue,
        HKCategoryValueSleepAnalysis.asleepCore.rawValue,
        HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
        HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
      ]
      return asleepValues.contains(value)
    }

    return value == HKCategoryValueSleepAnalysis.asleep.rawValue
  }

  private func workoutName(for type: HKWorkoutActivityType) -> String {
    switch type {
    case .walking:
      return "Walking"
    case .running:
      return "Running"
    case .cycling:
      return "Cycling"
    case .swimming:
      return "Swimming"
    case .traditionalStrengthTraining:
      return "Strength Training"
    case .functionalStrengthTraining:
      return "Functional Strength"
    case .hiking:
      return "Hiking"
    case .yoga:
      return "Yoga"
    default:
      return "Activity \(type.rawValue)"
    }
  }
}

internal final class InvalidPromptException: Exception {
  override var reason: String {
    "Prompt cannot be empty."
  }
}

internal final class UnsupportedOSErrorException: Exception {
  override var reason: String {
    "Apple Intelligence querying requires iOS 26.0 or newer."
  }
}

internal final class MissingFrameworkException: Exception {
  override var reason: String {
    "FoundationModels is unavailable in this Xcode SDK."
  }
}

internal final class HealthDataUnavailableException: Exception {
  override var reason: String {
    "Health data is unavailable on this device."
  }
}

internal final class HealthTypeUnavailableException: Exception {
  override var reason: String {
    "One or more HealthKit data types are unavailable."
  }
}

internal final class HealthAuthorizationException: GenericException<String> {
  override var reason: String {
    "Health authorization failed: \(param)"
  }
}

internal final class HealthQueryException: GenericException<String> {
  override var reason: String {
    "Health query failed: \(param)"
  }
}

internal final class CalendarAccessException: GenericException<String> {
  override var reason: String {
    "Calendar access failed: \(param)"
  }
}

internal final class CalendarAccessDeniedException: Exception {
  override var reason: String {
    "Calendar access was denied."
  }
}

internal final class CalendarUnavailableException: Exception {
  override var reason: String {
    "No default calendar is available for new events."
  }
}

internal final class CalendarSyncException: GenericException<String> {
  override var reason: String {
    "Calendar sync failed: \(param)"
  }
}

internal final class CalendarRemoveException: GenericException<String> {
  override var reason: String {
    "Calendar removal failed: \(param)"
  }
}

internal final class StorageKeyException: Exception {
  override var reason: String {
    "Storage key cannot be empty."
  }
}
