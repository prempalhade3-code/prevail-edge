#include "PrevailSnapshot.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

bool ParsePrevailSnapshot(const FString& Json, FPrevailSnapshot& OutSnapshot)
{
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		return false;
	}

	OutSnapshot = FPrevailSnapshot();
	OutSnapshot.CurrentEdgeId = Root->GetStringField(TEXT("current_edge_id"));

	const TSharedPtr<FJsonObject>* Authority = nullptr;
	if (Root->TryGetObjectField(TEXT("authority"), Authority) && Authority && Authority->IsValid())
	{
		OutSnapshot.AuthorityHolder = (*Authority)->GetStringField(TEXT("holder_edge_id"));
		OutSnapshot.Epoch = static_cast<int32>((*Authority)->GetNumberField(TEXT("epoch")));
	}

	const TSharedPtr<FJsonObject>* Prediction = nullptr;
	if (Root->TryGetObjectField(TEXT("prediction"), Prediction) && Prediction && Prediction->IsValid())
	{
		const TSharedPtr<FJsonObject>* Probs = nullptr;
		if ((*Prediction)->TryGetObjectField(TEXT("probabilities"), Probs) && Probs && Probs->IsValid())
		{
			for (const auto& Pair : (*Probs)->Values)
			{
				const FString EdgeId(Pair.Key);
				if (EdgeId == OutSnapshot.CurrentEdgeId)
				{
					continue;
				}
				const float P = static_cast<float>(Pair.Value->AsNumber());
				if (P > OutSnapshot.PredictionConfidence)
				{
					OutSnapshot.PredictionConfidence = P;
					OutSnapshot.PredictedEdgeId = EdgeId;
				}
			}
		}
	}

	double Lat = 0.0;
	double Lon = 0.0;
	if (Root->TryGetNumberField(TEXT("vehicle_latitude"), Lat) && Root->TryGetNumberField(TEXT("vehicle_longitude"), Lon))
	{
		OutSnapshot.bHasVehicle = true;
		OutSnapshot.VehicleLatitude = Lat;
		OutSnapshot.VehicleLongitude = Lon;
		Root->TryGetNumberField(TEXT("vehicle_heading"), OutSnapshot.VehicleHeading);
		Root->TryGetNumberField(TEXT("vehicle_speed_mps"), OutSnapshot.VehicleSpeedMps);
	}

	const TArray<TSharedPtr<FJsonValue>>* Traffic = nullptr;
	if (Root->TryGetArrayField(TEXT("traffic_vehicles"), Traffic) && Traffic)
	{
		for (const TSharedPtr<FJsonValue>& Value : *Traffic)
		{
			const TSharedPtr<FJsonObject> Car = Value->AsObject();
			if (!Car.IsValid())
			{
				continue;
			}
			FPrevailTrafficVehicle Row;
			Row.VehicleId = Car->GetStringField(TEXT("vehicle_id"));
			Row.Latitude = Car->GetNumberField(TEXT("latitude"));
			Row.Longitude = Car->GetNumberField(TEXT("longitude"));
			Row.HeadingDeg = Car->GetNumberField(TEXT("heading_deg"));
			Row.SpeedMps = Car->GetNumberField(TEXT("speed_mps"));
			OutSnapshot.Traffic.Add(MoveTemp(Row));
		}
	}

	return true;
}
