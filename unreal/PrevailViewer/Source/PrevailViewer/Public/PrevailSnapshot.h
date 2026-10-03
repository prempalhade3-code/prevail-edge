#pragma once

#include "CoreMinimal.h"
#include "PrevailSnapshot.generated.h"

USTRUCT(BlueprintType)
struct FPrevailTrafficVehicle
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	FString VehicleId;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double Latitude = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double Longitude = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double HeadingDeg = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double SpeedMps = 0.0;
};

USTRUCT(BlueprintType)
struct FPrevailSnapshot
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	FString CurrentEdgeId;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	FString AuthorityHolder;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	int32 Epoch = 0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	FString PredictedEdgeId;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	float PredictionConfidence = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double VehicleLatitude = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double VehicleLongitude = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double VehicleHeading = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	double VehicleSpeedMps = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	bool bHasVehicle = false;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	TArray<FPrevailTrafficVehicle> Traffic;
};

bool ParsePrevailSnapshot(const FString& Json, FPrevailSnapshot& OutSnapshot);
