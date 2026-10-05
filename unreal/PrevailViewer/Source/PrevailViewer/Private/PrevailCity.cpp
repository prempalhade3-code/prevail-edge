#include "PrevailCity.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "PrevailGeo.h"
#include "PrevailMaterials.h"
#include "ProceduralMeshComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	constexpr float FillRadiusCm = 42000.0f;
	constexpr float RefillMoveCm = 8000.0f;

	int32 ClassifyBuilding(const FString& Model, double X, double Z)
	{
		const float H = FMath::Frac(FMath::Sin(X * 12.9898f + Z * 78.233f) * 43758.5453f);
		const bool bHouse = Model.StartsWith(TEXT("building-type"));
		const bool bTower = Model.Contains(TEXT("skyscraper"));
		if (bTower || (!bHouse && H > 0.72f))
		{
			return 2;
		}
		if (!bHouse && H > 0.38f)
		{
			return 1;
		}
		return 0;
	}

	FVector BuildingScale(int32 Bucket, double X, double Z)
	{
		const float H = FMath::Frac(FMath::Sin(X * 12.9898f + Z * 78.233f) * 43758.5453f);
		if (Bucket == 2)
		{
			return FVector(1350.0f, 1350.0f, (46.0f + H * 38.0f) * 100.0f);
		}
		if (Bucket == 1)
		{
			return FVector(1500.0f, 1200.0f, (26.0f + H * 18.0f) * 100.0f);
		}
		return FVector(840.0f, 720.0f, (7.2f + H * 2.2f) * 100.0f);
	}

	void AddRibbon(
		TArray<FVector>& Verts,
		TArray<int32>& Tris,
		TArray<FVector>& Norms,
		TArray<FVector2D>& UVs,
		const TArray<FVector2D>& Pts,
		float Inner,
		float Outer,
		float Z)
	{
		if (Pts.Num() < 2)
		{
			return;
		}

		TArray<FVector2D> Side;
		Side.SetNum(Pts.Num());
		for (int32 i = 0; i < Pts.Num(); ++i)
		{
			const FVector2D Prev = Pts[FMath::Max(0, i - 1)];
			const FVector2D Next = Pts[FMath::Min(Pts.Num() - 1, i + 1)];
			FVector2D T = Next - Prev;
			T.Normalize();
			Side[i] = FVector2D(-T.Y, T.X);
		}

		const int32 Base = Verts.Num();
		float Run = 0.0f;
		for (int32 i = 0; i < Pts.Num(); ++i)
		{
			if (i > 0)
			{
				Run += FVector2D::Distance(Pts[i], Pts[i - 1]);
			}
			const FVector2D N = Side[i];
			Verts.Add(FVector(Pts[i].X + N.X * Inner, Pts[i].Y + N.Y * Inner, Z));
			Verts.Add(FVector(Pts[i].X + N.X * Outer, Pts[i].Y + N.Y * Outer, Z));
			Norms.Add(FVector::UpVector);
			Norms.Add(FVector::UpVector);
			UVs.Add(FVector2D(0.0f, Run * 0.0008f));
			UVs.Add(FVector2D(1.0f, Run * 0.0008f));
		}
		for (int32 i = 0; i < Pts.Num() - 1; ++i)
		{
			const int32 A = Base + i * 2;
			Tris.Add(A);
			Tris.Add(A + 1);
			Tris.Add(A + 2);
			Tris.Add(A + 1);
			Tris.Add(A + 3);
			Tris.Add(A + 2);
		}
	}
}

APrevailCity::APrevailCity()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.12f;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Ground = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Ground"));
	Ground->SetupAttachment(Root);
	Ground->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	RoadsMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Roads"));
	RoadsMesh->SetupAttachment(Root);
	RoadsMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	MarkingsMesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Markings"));
	MarkingsMesh->SetupAttachment(Root);
	MarkingsMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APrevailCity::BeginPlay()
{
	Super::BeginPlay();
	BuildGround();
	LoadScene();
	BuildRoads();
	BuildEdges();
	Refill(FVector::ZeroVector);
}

void APrevailCity::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
}

void APrevailCity::SetFocus(const FVector& WorldLocation)
{
	if (FVector::Dist2D(WorldLocation, LastFill) > RefillMoveCm)
	{
		Refill(WorldLocation);
	}
}

UMaterialInstanceDynamic* APrevailCity::MakeColor(const FLinearColor& Color)
{
	return PrevailMakeColor(this, Color);
}

UHierarchicalInstancedStaticMeshComponent* APrevailCity::MakePool(UStaticMesh* Mesh, UMaterialInterface* Material)
{
	UHierarchicalInstancedStaticMeshComponent* Pool = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
	Pool->SetupAttachment(Root);
	Pool->RegisterComponent();
	Pool->SetStaticMesh(Mesh);
	if (Material)
	{
		Pool->SetMaterial(0, Material);
	}
	Pool->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Pool->SetCastShadow(false);
	Pool->SetMobility(EComponentMobility::Static);
	return Pool;
}

void APrevailCity::BuildGround()
{
	if (UStaticMesh* Plane = PrevailPlane())
	{
		Ground->SetStaticMesh(Plane);
	}
	Ground->SetWorldScale3D(FVector(7000.0f, 7000.0f, 1.0f));
	Ground->SetWorldLocation(FVector(0.0f, 0.0f, -20.0f));
	if (UMaterialInstanceDynamic* Grass = MakeColor(FLinearColor(0.18f, 0.32f, 0.14f)))
	{
		Ground->SetMaterial(0, Grass);
	}
}

bool APrevailCity::ReadSceneFile(FString& OutJson) const
{
	TArray<FString> Candidates;
	Candidates.Add(FPaths::ProjectContentDir() / TEXT("City/scene.json"));
	Candidates.Add(FPaths::ConvertRelativePathToFull(FPaths::ProjectDir() / TEXT("../../frontend/public/city/scene.json")));
	for (const FString& Path : Candidates)
	{
		if (FPaths::FileExists(Path) && FFileHelper::LoadFileToString(OutJson, *Path))
		{
			return true;
		}
	}
	return false;
}

void APrevailCity::LoadScene()
{
	FString Json;
	if (!ReadSceneFile(Json))
	{
		UE_LOG(LogTemp, Error, TEXT("PREVAIL city scene.json was not found"));
		return;
	}

	TSharedPtr<FJsonObject> RootObj;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, RootObj) || !RootObj.IsValid())
	{
		return;
	}

	const TArray<TSharedPtr<FJsonValue>>* RoadRows = nullptr;
	if (RootObj->TryGetArrayField(TEXT("roads"), RoadRows) && RoadRows)
	{
		for (const TSharedPtr<FJsonValue>& Value : *RoadRows)
		{
			const TSharedPtr<FJsonObject> Row = Value->AsObject();
			if (!Row.IsValid())
			{
				continue;
			}
			FRoad Road;
			Road.HalfWidth = static_cast<float>(Row->GetNumberField(TEXT("half_width")) * 100.0);
			Road.Rank = static_cast<int32>(Row->GetNumberField(TEXT("rank")));
			const TArray<TSharedPtr<FJsonValue>>* Pts = nullptr;
			if (Row->TryGetArrayField(TEXT("pts"), Pts) && Pts)
			{
				for (const TSharedPtr<FJsonValue>& Pt : *Pts)
				{
					const TArray<TSharedPtr<FJsonValue>> XY = Pt->AsArray();
					if (XY.Num() >= 2)
					{
						Road.Pts.Add(FVector2D(XY[0]->AsNumber() * 100.0, XY[1]->AsNumber() * 100.0));
					}
				}
			}
			if (Road.Pts.Num() >= 2)
			{
				Roads.Add(MoveTemp(Road));
			}
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* RouteRows = nullptr;
	if (RootObj->TryGetArrayField(TEXT("route"), RouteRows) && RouteRows)
	{
		for (const TSharedPtr<FJsonValue>& Value : *RouteRows)
		{
			const TArray<TSharedPtr<FJsonValue>> XY = Value->AsArray();
			if (XY.Num() >= 2)
			{
				Route.Add(FVector2D(XY[0]->AsNumber() * 100.0, XY[1]->AsNumber() * 100.0));
			}
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* BuildingRows = nullptr;
	if (RootObj->TryGetArrayField(TEXT("buildings"), BuildingRows) && BuildingRows)
	{
		for (const TSharedPtr<FJsonValue>& Value : *BuildingRows)
		{
			const TSharedPtr<FJsonObject> Row = Value->AsObject();
			if (!Row.IsValid())
			{
				continue;
			}
			const double X = Row->GetNumberField(TEXT("x"));
			const double Z = Row->GetNumberField(TEXT("z"));
			FPlacement Item;
			Item.Bucket = ClassifyBuilding(Row->GetStringField(TEXT("model")), X, Z);
			Item.Scale = BuildingScale(Item.Bucket, X, Z);
			Item.Location = PrevailGeo::SceneToUnreal(X, Z, Item.Scale.Z * 0.5);
			Item.Yaw = PrevailGeo::SceneYawToUnreal(Row->GetNumberField(TEXT("yaw")));
			Buildings.Add(Item);
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* TreeRows = nullptr;
	if (RootObj->TryGetArrayField(TEXT("trees"), TreeRows) && TreeRows)
	{
		for (const TSharedPtr<FJsonValue>& Value : *TreeRows)
		{
			const TSharedPtr<FJsonObject> Row = Value->AsObject();
			if (!Row.IsValid())
			{
				continue;
			}
			const double X = Row->GetNumberField(TEXT("x"));
			const double Z = Row->GetNumberField(TEXT("z"));
			FPlacement Item;
			Item.Location = PrevailGeo::SceneToUnreal(X, Z, 350.0);
			Item.Yaw = 0.0f;
			Item.Scale = FVector(220.0f, 220.0f, 700.0f);
			Canopies.Add(Item);
		}
	}
}

void APrevailCity::BuildRoads()
{
	if (bRoadsBuilt)
	{
		return;
	}

	TArray<FVector> RoadVerts;
	TArray<int32> RoadTris;
	TArray<FVector> RoadNorms;
	TArray<FVector2D> RoadUVs;
	TArray<FVector> MarkVerts;
	TArray<int32> MarkTris;
	TArray<FVector> MarkNorms;
	TArray<FVector2D> MarkUVs;

	for (const FRoad& Road : Roads)
	{
		AddRibbon(RoadVerts, RoadTris, RoadNorms, RoadUVs, Road.Pts, -Road.HalfWidth, Road.HalfWidth, 6.0f);
		if (Road.Rank >= 4)
		{
			AddRibbon(MarkVerts, MarkTris, MarkNorms, MarkUVs, Road.Pts, -12.0f, 12.0f, 8.0f);
		}
	}
	if (Route.Num() >= 2)
	{
		AddRibbon(MarkVerts, MarkTris, MarkNorms, MarkUVs, Route, -18.0f, 18.0f, 10.0f);
	}

	if (RoadVerts.Num() > 0)
	{
		RoadsMesh->CreateMeshSection(0, RoadVerts, RoadTris, RoadNorms, RoadUVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
		RoadsMesh->SetMaterial(0, MakeColor(FLinearColor(0.07f, 0.07f, 0.08f)));
	}
	if (MarkVerts.Num() > 0)
	{
		MarkingsMesh->CreateMeshSection(0, MarkVerts, MarkTris, MarkNorms, MarkUVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
		MarkingsMesh->SetMaterial(0, MakeColor(FLinearColor(0.92f, 0.86f, 0.45f)));
	}
	bRoadsBuilt = true;
}

void APrevailCity::BuildEdges()
{
	// Cabinets are placed by GameMode from the live topology so they stay on
	// the same coordinates the backend is using this tick.
}

void APrevailCity::Refill(const FVector& Focus)
{
	if (!Houses)
	{
		Houses = MakePool(PrevailCube(), MakeColor(FLinearColor(0.76f, 0.70f, 0.62f)));
		Offices = MakePool(PrevailCube(), MakeColor(FLinearColor(0.48f, 0.52f, 0.58f)));
		Towers = MakePool(PrevailCube(), MakeColor(FLinearColor(0.09f, 0.11f, 0.16f)));
		Trees = MakePool(PrevailCone(), MakeColor(FLinearColor(0.10f, 0.26f, 0.11f)));
	}

	Houses->ClearInstances();
	Offices->ClearInstances();
	Towers->ClearInstances();
	Trees->ClearInstances();

	auto Fill = [&](UHierarchicalInstancedStaticMeshComponent* Pool, const TArray<FPlacement>& Items)
	{
		for (const FPlacement& Item : Items)
		{
			if (FVector::Dist2D(Item.Location, Focus) > FillRadiusCm)
			{
				continue;
			}
			const FTransform Xform(FRotator(0.0f, Item.Yaw, 0.0f), Item.Location, Item.Scale / 100.0f);
			Pool->AddInstance(Xform, true);
		}
	};

	TArray<FPlacement> HouseItems;
	TArray<FPlacement> OfficeItems;
	TArray<FPlacement> TowerItems;
	HouseItems.Reserve(Buildings.Num());
	OfficeItems.Reserve(Buildings.Num());
	TowerItems.Reserve(Buildings.Num());
	for (const FPlacement& Item : Buildings)
	{
		if (Item.Bucket == 2)
		{
			TowerItems.Add(Item);
		}
		else if (Item.Bucket == 1)
		{
			OfficeItems.Add(Item);
		}
		else
		{
			HouseItems.Add(Item);
		}
	}
	Fill(Houses, HouseItems);
	Fill(Offices, OfficeItems);
	Fill(Towers, TowerItems);
	Fill(Trees, Canopies);
	LastFill = Focus;
}
